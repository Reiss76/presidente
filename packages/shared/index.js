function buildHealthMeta(service) {
  return {
    ok: true,
    service,
    timestamp: new Date().toISOString(),
  };
}

module.exports = {
  buildHealthMeta,
};
