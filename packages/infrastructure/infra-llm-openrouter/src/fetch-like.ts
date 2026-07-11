/** The minimal fetch surface these adapters need — lets tests inject a fake instead of hitting the network. */
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;
