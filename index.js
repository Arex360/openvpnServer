const express = require('express');
const bodyParser = require('body-parser');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const port = 3000;

app.use(bodyParser.json());

function generateRandomName(length) {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function checkClientExists(client) {
  const indexFilePath = '/etc/openvpn/easy-rsa/pki/index.txt';
  try {
    const indexFileContent = fs.readFileSync(indexFilePath, 'utf8');
    const regex = new RegExp(`/CN=${client}\$`, 'm');
    return regex.test(indexFileContent);
  } catch (err) {
    console.error(`Error reading ${indexFilePath}:`, err);
    return false;
  }
}

function buildClient(client) {
  const openvpnPath = '/etc/openvpn/easy-rsa/';
  const command = `./easyrsa --batch build-client-full ${client} nopass`;
  try {
    execSync(command, { cwd: openvpnPath });
    console.log(`Client ${client} added.`);
    return true;
  } catch (err) {
    console.error('Error building client:', err);
    return false;
  }
}

function determineHomeDirectory(client) {
  if (fs.existsSync(`/home/${client}`)) {
    return `/home/${client}`;
  } else if (process.env.SUDO_USER) {
    return process.env.SUDO_USER === 'root' ? '/root' : `/home/${process.env.SUDO_USER}`;
  } else {
    return '/root';
  }
}

function generateClientConfig(client, homeDir, tlsSig) {
  const openvpnPath = '/etc/openvpn/';
  const templatePath = path.join(openvpnPath, 'client-template.txt');
  const caCertPath = path.join(openvpnPath, 'easy-rsa/pki/ca.crt');
  const clientCertPath = path.join(openvpnPath, `easy-rsa/pki/issued/${client}.crt`);
  const clientKeyPath = path.join(openvpnPath, `easy-rsa/pki/private/${client}.key`);
  const tlsCryptKeyPath = path.join(openvpnPath, 'tls-crypt.key');
  const tlsAuthKeyPath = path.join(openvpnPath, 'tls-auth.key');
  const ovpnFilePath = path.join(homeDir, `${client}.ovpn`);

  try {
    const configLines = [
      '<ca>',
      fs.readFileSync(caCertPath, 'utf8'),
      '</ca>',
      '<cert>',
      fs.readFileSync(clientCertPath, 'utf8').match(/(-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----)/),
      '</cert>',
      '<key>',
      fs.readFileSync(clientKeyPath, 'utf8'),
      '</key>'
    ];

    switch (tlsSig) {
      case 1:
        configLines.push('<tls-crypt>');
        configLines.push(fs.readFileSync(tlsCryptKeyPath, 'utf8'));
        configLines.push('</tls-crypt>');
        break;
      case 2:
        configLines.push('key-direction 1');
        configLines.push('<tls-auth>');
        configLines.push(fs.readFileSync(tlsAuthKeyPath, 'utf8'));
        configLines.push('</tls-auth>');
        break;
    }

    fs.writeFileSync(ovpnFilePath, configLines.join('\n'));
    console.log(`The configuration file has been written to ${ovpnFilePath}.`);
    return ovpnFilePath;
  } catch (err) {
    console.error('Error generating client config:', err);
    return null;
  }
}

app.get('/get', (req, res) => {
  const clientLength = 16;
  let client = generateRandomName(clientLength);

  console.log(`A random client name has been generated: ${client}`);

  while (checkClientExists(client)) {
    client = generateRandomName(clientLength);
  }

  const homeDir = determineHomeDirectory(client);

  if (!buildClient(client)) {
    res.status(500).json({ error: 'Client build failed' });
    return;
  }

  let tlsSig = 0; // Assuming 0 means no TLS method found
  if (fs.existsSync('/etc/openvpn/server.conf')) {
    const serverConfContent = fs.readFileSync('/etc/openvpn/server.conf', 'utf8');
    if (serverConfContent.includes('tls-crypt')) {
      tlsSig = 1;
    } else if (serverConfContent.includes('tls-auth')) {
      tlsSig = 2;
    }
  }

  const ovpnFilePath = generateClientConfig(client, homeDir, tlsSig);
  if (!ovpnFilePath) {
    res.status(500).json({ error: 'Error generating client configuration' });
    return;
  }

  const ovpnFileName = `${client}.ovpn`;
  res.download(ovpnFilePath, ovpnFileName, (err) => {
    if (err) {
      console.error('Error sending file:', err);
      res.status(500).json({ error: 'Error sending file' });
    } else {
      console.log('File sent successfully');
      // Clean up: delete the generated .ovpn file after sending
      fs.unlinkSync(ovpnFilePath);
    }
  });
});
app.get('/',(req,res)=>res.send("ok"))
app.listen(80, () => {
  console.log(`Server is running on http://localhost:${80}`);
});
