function render({ title, body }) {
  if (typeof title !== 'string' || typeof body !== 'string') throw new Error('Invalid export document.');
  return title + '\n' + body + '\n';
}

export const decoders = {
  v1(bytes) {
    const value = JSON.parse(bytes.toString());
    if (value.version !== 1) throw new Error('Expected export V1.');
    return render(value);
  },
  v2(bytes) {
    const value = JSON.parse(bytes.toString());
    if (value.version !== 2) throw new Error('Expected export V2.');
    return render(value.document);
  }
};
