export const decoders = {
  v2(bytes) {
    const value = JSON.parse(bytes.toString());
    if (value.version !== 2) throw new Error('Expected export V2.');
    const { title, body } = value.document;
    if (typeof title !== 'string' || typeof body !== 'string') throw new Error('Invalid export document.');
    return title + '\n' + body + '\n';
  }
};
