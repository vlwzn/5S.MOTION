import { createReadStream } from "node:fs";
import {
  mkdir,
  readFile,
  rename,
  rmdir,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)));
const projectFile = join(root, "projects.json");
const uploadRoot = join(root, "uploads");
const maxUploadBytes = 64 * 1024 * 1024;
const maxJsonBytes = 90 * 1024 * 1024;
const projectSlugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const fileNamePattern = /^[a-z0-9-]+\.(?:png|jpe?g|gif|mp4|webm|mov)$/;
const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mov": "video/quicktime",
  ".mp4": "video/mp4",
  ".png": "image/png",
  ".webm": "video/webm",
};
const routes = new Map([
  ["/", "index.html"],
  ["/index.html", "index.html"],
  ["/project.html", "project.html"],
  ["/dashboard", "dashboard.html"],
  ["/dashboard/", "dashboard.html"],
  ["/dashboard.html", "dashboard.html"],
  ["/projects.json", "projects.json"],
  ["/assets/css/styles.css", "assets/css/styles.css"],
  ["/assets/css/dashboard.css", "assets/css/dashboard.css"],
  ["/assets/js/script.js", "assets/js/script.js"],
  ["/assets/js/dashboard.js", "assets/js/dashboard.js"],
]);

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

let writeQueue = Promise.resolve();

async function readProjects() {
  const contents = await readFile(projectFile, "utf8");
  const projects = JSON.parse(contents);
  if (!Array.isArray(projects)) {
    throw new Error("projects.json must contain a project array.");
  }
  return projects;
}

function updateProjects(mutator) {
  const transaction = writeQueue.then(async () => {
    const projects = await readProjects();
    const result = await mutator(projects);
    const temporaryFile = `${projectFile}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporaryFile, `${JSON.stringify(projects, null, 2)}\n`, "utf8");
      await rename(temporaryFile, projectFile);
    } catch (error) {
      await unlink(temporaryFile).catch(() => {});
      throw error;
    }
    return result;
  });
  writeQueue = transaction.catch(() => {});
  return transaction;
}

async function readJsonBody(request, limit = maxJsonBytes) {
  const length = Number(request.headers["content-length"] ?? 0);
  if (Number.isFinite(length) && length > limit) {
    throw new HttpError(413, "Request is too large.");
  }

  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > limit) {
      throw new HttpError(413, "Request is too large.");
    }
    chunks.push(chunk);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "Request body must be valid JSON.");
  }
}

function validateProject(project, existingProjects, currentSlug) {
  if (!project || typeof project !== "object" || Array.isArray(project)) {
    throw new HttpError(400, "Project details are required.");
  }

  const fields = ["slug", "title", "year", "client", "studio", "description"];
  fields.forEach((field) => {
    if (typeof project[field] !== "string" || project[field].trim().length === 0) {
      throw new HttpError(400, `The ${field} field is required.`);
    }
  });

  if (!projectSlugPattern.test(project.slug) || project.slug.length > 80) {
    throw new HttpError(400, "Use a URL slug with lowercase letters, numbers, and hyphens.");
  }
  if (
    existingProjects.some(
      (existing) => existing.slug === project.slug && existing.slug !== currentSlug,
    )
  ) {
    throw new HttpError(409, "That project URL is already in use.");
  }
  if (project.title.length > 80 || project.client.length > 100 || project.studio.length > 100) {
    throw new HttpError(400, "Project names and credits are too long.");
  }
  if (project.year.length > 12 || project.description.length > 1200) {
    throw new HttpError(400, "The project year or description is too long.");
  }

  return Object.fromEntries(fields.map((field) => [field, project[field].trim()]));
}

function validateProjectCover(project, slug, title) {
  const image = typeof project.image === "string" ? project.image : "";
  const imageAlt = typeof project.imageAlt === "string" ? project.imageAlt.trim() : title;
  const validUpload =
    image.startsWith(`/uploads/${slug}/`) &&
    fileNamePattern.test(image.slice(`/uploads/${slug}/`.length));

  if (image && !validUpload) {
    throw new HttpError(400, "The homepage preview must use media from this project.");
  }
  if (imageAlt.length > 180) {
    throw new HttpError(400, "The preview image description is too long.");
  }
  return { image, imageAlt: imageAlt || title };
}

function getMediaInfo(file) {
  if (!file || typeof file.name !== "string" || typeof file.data !== "string") {
    throw new HttpError(400, "Each upload needs a filename and base64 file data.");
  }

  const extension = extname(file.name).toLowerCase();
  const formats = {
    ".png": { type: "image", signature: (data) => data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) },
    ".jpg": { type: "image", signature: (data) => data[0] === 255 && data[1] === 216 && data[2] === 255 },
    ".jpeg": { type: "image", signature: (data) => data[0] === 255 && data[1] === 216 && data[2] === 255 },
    ".gif": { type: "image", signature: (data) => ["GIF87a", "GIF89a"].includes(data.toString("ascii", 0, 6)) },
    ".mp4": { type: "video", signature: (data) => data.toString("ascii", 4, 8) === "ftyp" },
    ".mov": { type: "video", signature: (data) => data.toString("ascii", 4, 8) === "ftyp" },
    ".webm": { type: "video", signature: (data) => data.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])) },
  };
  const format = formats[extension];
  if (!format) {
    throw new HttpError(415, "Supported files are PNG, JPG, GIF, MP4, WebM, and MOV.");
  }
  const maxBase64Length = Math.ceil(maxUploadBytes / 3) * 4;
  if (file.data.length === 0 || file.data.length > maxBase64Length) {
    throw new HttpError(413, "Each photo or video must be smaller than 64 MB.");
  }
  const buffer = Buffer.from(file.data, "base64");
  if (buffer.toString("base64") !== file.data) {
    throw new HttpError(400, "The uploaded file data is not valid base64.");
  }

  if (buffer.length === 0 || buffer.length > maxUploadBytes) {
    throw new HttpError(413, "Each photo or video must be smaller than 64 MB.");
  }
  if (!format.signature(buffer)) {
    throw new HttpError(415, `The file contents do not match its .${extension.slice(1)} extension.`);
  }

  return {
    buffer,
    extension,
    type: format.type,
    name: file.name.slice(-180),
    alt: typeof file.alt === "string" ? file.alt.trim().slice(0, 180) : "",
  };
}

function validateMediaUrl(slug, filename) {
  if (!projectSlugPattern.test(slug) || !fileNamePattern.test(filename)) {
    throw new HttpError(400, "Invalid project media path.");
  }
  return join(uploadRoot, slug, filename);
}

function sendJson(response, status, value) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(value));
}

async function handleApi(request, response, pathname) {
  if (pathname === "/api/projects" && request.method === "GET") {
    sendJson(response, 200, await readProjects());
    return true;
  }

  if (pathname === "/api/projects" && request.method === "POST") {
    const body = await readJsonBody(request, 32 * 1024);
    const project = await updateProjects(async (projects) => {
      const details = validateProject(body, projects);
      const created = {
        ...details,
        image: "",
        imageAlt: details.title,
        gallery: [],
      };
      projects.push(created);
      return created;
    });
    sendJson(response, 201, project);
    return true;
  }

  const mediaDeleteMatch = pathname.match(
    /^\/api\/projects\/([a-z0-9-]+)\/media\/([a-z0-9-]+\.(?:png|jpe?g|gif|mp4|webm|mov))$/,
  );
  if (mediaDeleteMatch && request.method === "DELETE") {
    const [, slug, filename] = mediaDeleteMatch;
    const filePath = validateMediaUrl(slug, filename);
    const mediaUrl = `/uploads/${slug}/${filename}`;
    const updatedProject = await updateProjects(async (projects) => {
      const project = projects.find((entry) => entry.slug === slug);
      if (!project) {
        throw new HttpError(404, "Project not found.");
      }
      const mediaIndex = project.gallery.findIndex(
        (item) => (item.src ?? item.image) === mediaUrl,
      );
      if (mediaIndex < 0) {
        throw new HttpError(404, "Project media not found.");
      }

      const [removed] = project.gallery.splice(mediaIndex, 1);
      const removedWasCover = project.image === mediaUrl;
      if (removedWasCover) {
        const replacementCover = project.gallery[0];
        project.image = replacementCover?.src ?? replacementCover?.image ?? "";
        project.imageAlt = replacementCover?.alt || project.title;
      }
      return project;
    });

    await unlink(filePath).catch((error) => {
      if (error.code !== "ENOENT") {
        throw error;
      }
    });
    sendJson(response, 200, updatedProject);
    return true;
  }

  const mediaMatch = pathname.match(/^\/api\/projects\/([a-z0-9-]+)\/media$/);
  if (mediaMatch && request.method === "POST") {
    const [, slug] = mediaMatch;
    const body = await readJsonBody(request);
    if (!Array.isArray(body.files) || body.files.length < 1 || body.files.length > 8) {
      throw new HttpError(400, "Upload between one and eight files at a time.");
    }
    const mediaFiles = body.files.map(getMediaInfo);
    const filePaths = [];

    try {
      const project = await updateProjects(async (projects) => {
        const target = projects.find((entry) => entry.slug === slug);
        if (!target) {
          throw new HttpError(404, "Project not found.");
        }

        const directory = join(uploadRoot, slug);
        await mkdir(directory, { recursive: true });
        const newItems = [];
        for (const media of mediaFiles) {
          const filename = `${Date.now()}-${randomUUID().slice(0, 8)}${media.extension}`;
          const filePath = validateMediaUrl(slug, filename);
          await writeFile(filePath, media.buffer, { flag: "wx" });
          filePaths.push(filePath);

          const item = {
            type: media.type,
            src: `/uploads/${slug}/${filename}`,
            alt: media.alt || target.title,
            name: media.name,
            size: media.buffer.length,
          };
          target.gallery.push(item);
          newItems.push(item);

          if (!target.image) {
            target.image = item.src;
            target.imageAlt = item.alt;
          }
        }
        return { project: target, media: newItems };
      });
      sendJson(response, 201, project);
    } catch (error) {
      await Promise.all(filePaths.map((filePath) => unlink(filePath).catch(() => {})));
      throw error;
    }
    return true;
  }

  const projectMatch = pathname.match(/^\/api\/projects\/([a-z0-9-]+)$/);
  if (projectMatch && request.method === "PUT") {
    const [, slug] = projectMatch;
    const body = await readJsonBody(request, 32 * 1024);
    const project = await updateProjects((projects) => {
      const index = projects.findIndex((entry) => entry.slug === slug);
      if (index < 0) {
        throw new HttpError(404, "Project not found.");
      }
      const details = validateProject(body, projects, slug);
      const cover = validateProjectCover(body, slug, details.title);
      projects[index] = {
        ...projects[index],
        ...details,
        ...cover,
      };
      return projects[index];
    });
    sendJson(response, 200, project);
    return true;
  }

  if (projectMatch && request.method === "DELETE") {
    const [, slug] = projectMatch;
    const project = await updateProjects((projects) => {
      const index = projects.findIndex((entry) => entry.slug === slug);
      if (index < 0) {
        throw new HttpError(404, "Project not found.");
      }
      return projects.splice(index, 1)[0];
    });
    const uploadedFiles = project.gallery
      .map((item) => item.src ?? item.image)
      .map((source) => source?.match(new RegExp(`^/uploads/${slug}/([a-z0-9-]+\\.(?:png|jpe?g|gif|mp4|webm|mov))$`)))
      .filter(Boolean)
      .map((match) => validateMediaUrl(slug, match[1]));
    await Promise.all(
      uploadedFiles.map((filePath) =>
        unlink(filePath).catch((error) => {
          if (error.code !== "ENOENT") {
            throw error;
          }
        }),
      ),
    );
    await rmdir(join(uploadRoot, slug)).catch((error) => {
      if (error.code !== "ENOENT" && error.code !== "ENOTEMPTY") {
        throw error;
      }
    });
    sendJson(response, 200, { deleted: project.slug });
    return true;
  }

  return false;
}

function sendStaticFile(request, response, filePath, contentType, options = {}) {
  let fileStats;
  try {
    fileStats = stat(filePath);
  } catch (error) {
    if (error.code === "ENOENT") {
      response.writeHead(404).end("Not found");
      return;
    }
    throw error;
  }

  fileStats.then((details) => {
    if (!details.isFile()) {
      response.writeHead(404).end("Not found");
      return;
    }

    const headers = {
      "Accept-Ranges": options.allowRanges ? "bytes" : "none",
      "Cache-Control": options.upload ? "public, max-age=31536000, immutable" : "no-cache",
      "Content-Length": details.size,
      "Content-Type": contentType,
      "X-Content-Type-Options": "nosniff",
    };
    let start = 0;
    let end = details.size - 1;
    let status = 200;

    if (options.allowRanges && request.headers.range) {
      const range = request.headers.range.match(/^bytes=(\d*)-(\d*)$/);
      if (!range) {
        response.writeHead(416, { "Content-Range": `bytes */${details.size}` }).end();
        return;
      }
      if (range[1] === "") {
        const suffixLength = Number(range[2]);
        start = Math.max(0, details.size - suffixLength);
      } else {
        start = Number(range[1]);
        end = range[2] === "" ? end : Math.min(Number(range[2]), end);
      }
      if (start >= details.size || start > end) {
        response.writeHead(416, { "Content-Range": `bytes */${details.size}` }).end();
        return;
      }
      headers["Content-Length"] = end - start + 1;
      headers["Content-Range"] = `bytes ${start}-${end}/${details.size}`;
      status = 206;
    }

    response.writeHead(status, headers);
    if (request.method === "HEAD") {
      response.end();
      return;
    }

    const stream = createReadStream(filePath, { start, end });
    stream.on("error", (error) => {
      if (response.headersSent) {
        response.destroy(error);
      } else {
        console.error(error);
        response.writeHead(500).end("Internal server error");
      }
    });
    stream.pipe(response);
  }).catch((error) => {
    if (error.code === "ENOENT") {
      response.writeHead(404).end("Not found");
      return;
    }
    console.error(error);
    if (!response.headersSent) {
      response.writeHead(500).end("Internal server error");
    }
  });
}

const server = createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
    if (pathname.startsWith("/api/")) {
      const handled = await handleApi(request, response, pathname);
      if (!handled) {
        sendJson(response, 404, { error: "API route not found." });
      }
      return;
    }

    if (!["GET", "HEAD"].includes(request.method ?? "")) {
      response.writeHead(405, { Allow: "GET, HEAD" }).end("Method not allowed");
      return;
    }

    const uploadedMedia = pathname.match(
      /^\/uploads\/([a-z0-9-]+)\/([a-z0-9-]+\.(?:png|jpe?g|gif|mp4|webm|mov))$/,
    );
    if (uploadedMedia) {
      const [, slug, filename] = uploadedMedia;
      sendStaticFile(
        request,
        response,
        validateMediaUrl(slug, filename),
        contentTypes[extname(filename)],
        { allowRanges: true, upload: true },
      );
      return;
    }

    const projectMatch = pathname.match(/^\/project\/([a-z0-9]+(?:-[a-z0-9]+)*)\/?$/);
    let relativePath = routes.get(pathname);
    if (projectMatch) {
      const projects = await readProjects();
      relativePath = projects.some((project) => project.slug === projectMatch[1])
        ? "project.html"
        : undefined;
    }
    if (!relativePath) {
      response.writeHead(404).end("Not found");
      return;
    }

    const filePath = resolve(root, relativePath);
    if (!filePath.startsWith(`${root}${sep}`)) {
      response.writeHead(404).end("Not found");
      return;
    }
    sendStaticFile(request, response, filePath, contentTypes[extname(filePath)]);
  } catch (error) {
    if (error instanceof HttpError) {
      sendJson(response, error.status, { error: error.message });
      return;
    }
    console.error(error);
    if (!response.headersSent) {
      sendJson(response, 500, { error: "The request could not be completed." });
    } else {
      response.destroy(error);
    }
  }
});

server.listen(4173, "127.0.0.1", () => {
  console.log("5S.MOTION is running at http://127.0.0.1:4173");
});
