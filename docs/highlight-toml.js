document.addEventListener("DOMContentLoaded", () => {
  document
    .querySelectorAll("code.language-toml")
    .forEach((block) => window.hljs.highlightElement(block));
});
