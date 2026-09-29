/* Classic-worker script (importScripts) that is also loadable from tests via module.exports.
 * Runs fn with a per-call clustering, and always puts the recording clustering back. */
function withClustering(sd, clustering, restore, fn) {
  sd.setConfig({ clustering });
  try {
    return fn();
  } finally {
    sd.setConfig({ clustering: restore });
  }
}
if (typeof self !== 'undefined') self.withClustering = withClustering;
if (typeof module !== 'undefined') module.exports = { withClustering };
