/**
 * What a router hands a controller about the request. Controllers never see `req`/`res`; anything
 * they need from the request (ids for logging, the acting user, the organization) travels here.
 */
export interface RequestContext {
  requestId?: string
  /** Vapi's call id, on requests from the phone agent. */
  callId?: string
}
