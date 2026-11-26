export const decoders = {
  delimited(bytes) {
    const parts = bytes.toString().split('\t');
    if (parts.length !== 2 || !parts.every(Boolean)) throw new Error('Invalid legacy delivery.');
    return parts.join(':');
  },
  json(bytes) {
    const { subscriber, event } = JSON.parse(bytes.toString());
    if (typeof subscriber !== 'string' || typeof event?.type !== 'string') throw new Error('Invalid delivery intent.');
    return subscriber + ':' + event.type;
  }
};
