// The host app is built with Vite, which provides import.meta.env at build time
// (the MediaPipe loader reads BASE_URL to find the files under public/).
interface ImportMeta {
  readonly env: { readonly BASE_URL: string };
}
