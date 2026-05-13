// Ambient declaration for the `[[rules]] type = "Text"` Markdown imports.
// esbuild (via wrangler) inlines `.md` file contents as the default export
// at bundle time. The actual module shape is just a string.
declare module "*.md" {
  const content: string;
  export default content;
}
