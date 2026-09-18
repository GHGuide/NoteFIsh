/** A provider's own failure, in its own words. Kept in its own file so the
 *  modules that raise it do not have to import each other to do so. */
export class ProviderError extends Error {
  constructor(message, status = 502, code = 'provider_error') {
    super(message); this.name = 'ProviderError'; this.status = status; this.code = code;
  }
}
