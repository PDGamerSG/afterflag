export function encode(codec, { destination, event }) {
  if (codec === 'delimited') return destination + '\t' + event;
  if (codec === 'json') return JSON.stringify({ subscriber: destination, event: { type: event } });
  throw new Error('Unknown delivery format.');
}
