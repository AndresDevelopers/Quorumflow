import { parseServiceAccountKey } from '../firebase-admin';

describe('parseServiceAccountKey', () => {
  const validConfig = {
    project_id: 'test-project',
    private_key: '-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n',
    client_email: 'test@example.com',
  };
  const validJson = JSON.stringify(validConfig);

  it('parses valid JSON string', () => {
    const result = parseServiceAccountKey(validJson);
    expect(result).toBeTruthy();
    expect(result?.projectId).toBe('test-project');
    expect(result?.project_id).toBe('test-project');
  });

  it('parses valid base64 encoded JSON string', () => {
    const base64Json = Buffer.from(validJson).toString('base64');
    const result = parseServiceAccountKey(base64Json);
    expect(result).toBeTruthy();
    expect(result?.projectId).toBe('test-project');
  });

  it('parses double-encoded JSON string', () => {
    const doubleEncoded = JSON.stringify(validJson);
    const result = parseServiceAccountKey(doubleEncoded);
    expect(result).toBeTruthy();
    const parsed =
      typeof result === 'string' ? JSON.parse(result) : result;
    expect(parsed?.projectId || parsed?.project_id).toBe('test-project');
  });

  it('returns null for invalid inputs', () => {
    expect(parseServiceAccountKey('not-a-json')).toBe(null);
    expect(parseServiceAccountKey('')).toBe(null);
    // Empty object is valid JSON; function returns it
    expect(parseServiceAccountKey('{}')).toEqual({});
  });

  it('normalizes private key with literal newlines', () => {
    const configWithLiteralNewlines = {
      ...validConfig,
      private_key:
        '-----BEGIN PRIVATE KEY-----\nline1\nline2\n-----END PRIVATE KEY-----\n',
    };
    const mangledJson = JSON.stringify(configWithLiteralNewlines).replace(
      /\\n/g,
      '\n',
    );
    const result = parseServiceAccountKey(mangledJson);
    expect(result).toBeTruthy();
    const pk =
      (result as { private_key?: string; privateKey?: string }).private_key ||
      result?.privateKey;
    expect(pk?.includes('\n')).toBe(true);
  });
});
