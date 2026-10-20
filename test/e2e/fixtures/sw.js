self.addEventListener('message', async (e) => {
  const result = await fetch(e.data, { mode: 'no-cors', cache: 'no-store' }).then(() => 'loaded', () => 'blocked');
  e.source.postMessage(result);
});
