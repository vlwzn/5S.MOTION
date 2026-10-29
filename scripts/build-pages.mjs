import { cp, mkdir, readFile, writeFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const output = new URL("../dist/", import.meta.url);
const staticFiles = ["index.html", "project.html", "projects.json"];

await mkdir(output, { recursive: true });
await Promise.all(
  ["assets/css/", "assets/js/", "uploads/"].map((directory) =>
    mkdir(new URL(directory, output), { recursive: true }),
  ),
);

for (const file of staticFiles) {
  const source = new URL(file, root);
  const destination = new URL(file, output);
  let contents = await readFile(source, "utf8");

  if (file.endsWith(".html")) {
    contents = contents
      .replace('<meta name="site-base" content="/" />', '<meta name="site-base" content="/5S.MOTION/" />')
      .replaceAll('href="/assets/', 'href="/5S.MOTION/assets/')
      .replaceAll('src="/assets/', 'src="/5S.MOTION/assets/');
  }

  await writeFile(destination, contents);
}

await cp(new URL("assets/css/styles.css", root), new URL("assets/css/styles.css", output));
await cp(new URL("assets/js/script.js", root), new URL("assets/js/script.js", output));
await cp(new URL("uploads/", root), new URL("uploads/", output), { recursive: true });

console.log("Built GitHub Pages site in dist/.");
