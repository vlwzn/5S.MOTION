const projectPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const siteBasePath =
  document.querySelector('meta[name="site-base"]')?.content.replace(/\/$/, "") ?? "";

function sitePath(path) {
  if (!siteBasePath || !path.startsWith("/") || path.startsWith(`${siteBasePath}/`)) {
    return path;
  }
  return `${siteBasePath}${path}`;
}

function projectPath(slug) {
  return siteBasePath
    ? `${sitePath("/project.html")}?slug=${encodeURIComponent(slug)}`
    : `/project/${slug}`;
}

function getElement(selector) {
  const element = document.querySelector(selector);
  if (!(element instanceof HTMLElement)) {
    throw new Error(`Required page element is missing: ${selector}`);
  }
  return element;
}

function createTextElement(tagName, className, text) {
  const element = document.createElement(tagName);
  element.className = className;
  element.textContent = text;
  return element;
}

async function loadProjects() {
  const response = await fetch(sitePath("/projects.json"));
  if (!response.ok) {
    throw new Error(`Unable to load projects (${response.status})`);
  }

  const projects = await response.json();
  if (
    !Array.isArray(projects) ||
    projects.some(
      (project) =>
        !project ||
        typeof project.slug !== "string" ||
        !projectPattern.test(project.slug) ||
        typeof project.title !== "string" ||
        typeof project.year !== "string" ||
        typeof project.description !== "string" ||
        typeof project.image !== "string" ||
        typeof project.imageAlt !== "string" ||
        typeof project.client !== "string" ||
        typeof project.studio !== "string" ||
        !Array.isArray(project.gallery) ||
        project.gallery.some(
          (item) =>
            !item ||
            typeof (item.src ?? item.image) !== "string" ||
            typeof item.alt !== "string",
        ),
    )
  ) {
    throw new Error("Project data is empty or has an invalid format.");
  }

  return projects;
}

function setActiveProject(project, index, projects) {
  const art = getElement("[data-art]");
  const activePreview = document.querySelector(
    `[data-project-preview="${CSS.escape(project.slug)}"]`,
  );

  document.querySelectorAll("[data-project-link]").forEach((link) => {
    link.classList.toggle("is-active", link.dataset.projectLink === project.slug);
  });
  document.querySelectorAll("[data-project-preview]").forEach((preview) => {
    const isActive = preview.dataset.projectPreview === project.slug;
    preview.classList.toggle("is-active", isActive);
    preview.setAttribute("aria-hidden", String(!isActive));
    if (preview instanceof HTMLVideoElement) {
      if (isActive) {
        preview.play().catch((error) => console.error("Unable to play homepage preview.", error));
      } else {
        preview.pause();
      }
    }
  });

  getElement("[data-project-title]").textContent = project.title;
  getElement("[data-work-index]").textContent =
    `${String(index + 1).padStart(2, "0")} / ${String(projects.length).padStart(2, "0")}`;
  getElement("[data-footer-project]").textContent = `${project.title} — ${project.year}`;
  getElement("[data-art-caption]").textContent = `5S.MOTION — ${project.year}`;
  art.setAttribute("aria-label", project.imageAlt || project.title);
  if (activePreview instanceof HTMLImageElement && activePreview.complete) {
    resizeArtwork(activePreview.naturalWidth, activePreview.naturalHeight);
  } else if (activePreview instanceof HTMLVideoElement && activePreview.readyState >= 1) {
    resizeArtwork(activePreview.videoWidth, activePreview.videoHeight);
  }
  document.title = `5S.MOTION — ${project.title}`;
}

function getProjectPreview(project) {
  const fallbackMedia = project.gallery.find((item) => item.src || item.image);
  const source = sitePath(project.image || (fallbackMedia?.src ?? fallbackMedia?.image ?? ""));
  return {
    source,
    alt: project.imageAlt || fallbackMedia?.alt || project.title,
  };
}

function resizeArtwork(mediaWidth, mediaHeight) {
  if (!mediaWidth || !mediaHeight) {
    return;
  }

  const art = getElement("[data-art]");
  const maxWidth = getElement(".work-display").clientWidth;
  const viewportHeight = window.innerHeight;
  const maxHeight =
    window.innerWidth <= 760
      ? Math.min(viewportHeight * 0.44, Math.max(0, (viewportHeight - 220) * 0.68))
      : Math.min(viewportHeight * 0.54, viewportHeight - 200, 620);
  const scale = Math.min(maxWidth / mediaWidth, maxHeight / mediaHeight);
  art.style.width = `${Math.max(1, Math.round(mediaWidth * scale))}px`;
  art.style.height = `${Math.max(1, Math.round(mediaHeight * scale))}px`;
}

function createProjectPreview(project) {
  const { source, alt } = getProjectPreview(project);
  if (!source) {
    return null;
  }

  const isVideo =
    /\.(?:mp4|webm|mov)$/i.test(source) ||
    project.gallery.some(
      (item) => (item.src ?? item.image) === source && item.type === "video",
    );
  const preview = isVideo ? document.createElement("video") : document.createElement("img");
  preview.className = "project-artwork";
  preview.src = source;
  preview.dataset.projectPreview = project.slug;
  preview.setAttribute("aria-hidden", "true");

  if (preview instanceof HTMLVideoElement) {
    preview.muted = true;
    preview.loop = true;
    preview.playsInline = true;
    preview.preload = "metadata";
    preview.addEventListener("loadedmetadata", () => {
      if (preview.classList.contains("is-active")) {
        resizeArtwork(preview.videoWidth, preview.videoHeight);
      }
    });
  } else {
    preview.alt = alt;
    preview.draggable = false;
    preview.addEventListener("load", () => {
      if (preview.classList.contains("is-active")) {
        resizeArtwork(preview.naturalWidth, preview.naturalHeight);
      }
    });
  }
  return preview;
}

function createProjectLink(project, index, projects) {
  const link = document.createElement("a");
  link.className = "work-link";
  link.href = projectPath(project.slug);
  link.dataset.projectLink = project.slug;

  link.append(
    createTextElement("span", "work-link-number", String(index + 1).padStart(2, "0")),
    createTextElement("span", "work-link-title", project.title),
  );
  const arrow = createTextElement("span", "work-link-arrow", "↗");
  arrow.setAttribute("aria-hidden", "true");
  link.append(arrow);

  link.addEventListener("pointerenter", () => setActiveProject(project, index, projects));
  link.addEventListener("focus", () => setActiveProject(project, index, projects));
  return link;
}

function initializeHome(projects) {
  const art = getElement("[data-art]");
  const workList = getElement("[data-work-list]");
  const note = workList.querySelector(".work-list-note");

  if (projects.length === 0) {
    getElement("[data-project-title]").textContent = "No projects yet";
    getElement("[data-work-index]").textContent = "00 / 00";
    getElement("[data-footer-project]").textContent = "";
    getElement("[data-art-caption]").textContent = "5S.MOTION";
    art.setAttribute("aria-label", "No projects available");
  }

  projects.forEach((project, index) => {
    const preview = createProjectPreview(project);
    if (preview) {
      art.insertBefore(preview, art.querySelector(".art-caption"));
    }
    workList.insertBefore(createProjectLink(project, index, projects), note);
  });
  const firstProjectWithPreview = projects.findIndex(
    (project) => getProjectPreview(project).source,
  );
  if (firstProjectWithPreview >= 0) {
    setActiveProject(projects[firstProjectWithPreview], firstProjectWithPreview, projects);
  }
  window.addEventListener("resize", () => {
    const activePreview = document.querySelector("[data-project-preview].is-active");
    if (activePreview instanceof HTMLImageElement && activePreview.complete) {
      resizeArtwork(activePreview.naturalWidth, activePreview.naturalHeight);
    } else if (activePreview instanceof HTMLVideoElement && activePreview.readyState >= 1) {
      resizeArtwork(activePreview.videoWidth, activePreview.videoHeight);
    }
  });

  const xValue = getElement("[data-x]");
  const yValue = getElement("[data-y]");

  art.addEventListener("pointermove", (event) => {
    const bounds = art.getBoundingClientRect();
    const x = Math.round(((event.clientX - bounds.left) / bounds.width) * 100);
    const y = Math.round(((event.clientY - bounds.top) / bounds.height) * 100);
    art.style.setProperty("--pointer-x", `${x}%`);
    art.style.setProperty("--pointer-y", `${y}%`);
    art.style.setProperty("--shift-x", `${(50 - x) * 0.08}px`);
    art.style.setProperty("--shift-y", `${(50 - y) * 0.08}px`);
    xValue.textContent = String(x).padStart(2, "0");
    yValue.textContent = String(y).padStart(2, "0");
  });

  art.addEventListener("pointerleave", () => {
    art.style.setProperty("--pointer-x", "50%");
    art.style.setProperty("--pointer-y", "50%");
    art.style.setProperty("--shift-x", "0px");
    art.style.setProperty("--shift-y", "0px");
    xValue.textContent = "00";
    yValue.textContent = "00";
  });
}

function createGalleryItem(item) {
  const figure = document.createElement("figure");
  figure.className = `detail-gallery-item${item.detail ? " detail-gallery-item--detail" : ""}`;

  const source = sitePath(item.src || item.image);
  const isVideo = item.type === "video" || /\.(?:mp4|webm|mov)$/i.test(source);
  if (isVideo) {
    const video = document.createElement("video");
    video.src = source;
    video.controls = true;
    video.preload = "metadata";
    video.playsInline = true;
    video.setAttribute("aria-label", item.alt);
    figure.append(video);
  } else {
    const image = document.createElement("img");
    image.src = source;
    image.alt = item.alt;
    image.loading = "lazy";
    figure.append(image);
  }
  return figure;
}

function initializeProjectPage(projects) {
  const slug =
    new URLSearchParams(window.location.search).get("slug") ||
    window.location.pathname.split("/").filter(Boolean).at(-1);
  const projectIndex = projects.findIndex((project) => project.slug === slug);
  const project = projects[projectIndex];

  if (!project) {
    const message = getElement("[data-detail-message]");
    message.textContent = "Project not found.";
    message.hidden = false;
    return;
  }

  getElement("[data-detail-page]").hidden = false;
  document.title = `${project.title} — 5S.MOTION`;
  document.querySelector('meta[name="description"]')?.setAttribute(
    "content",
    `${project.title} — selected work by 5S.MOTION.`,
  );
  getElement("[data-detail-period]").textContent = `${project.title} / ${project.year}`;
  getElement("[data-detail-title]").textContent = project.title;
  getElement("[data-detail-description]").textContent = project.description;

  const gallery = getElement("[data-detail-gallery]");
  project.gallery.forEach((item) => gallery.append(createGalleryItem(item)));

  const credits = getElement("[data-detail-credits]");
  [
    ["Client", project.client],
    ["Studio", project.studio],
    ["Year", project.year],
  ].forEach(([label, value]) => {
    credits.append(
      createTextElement("dt", "", label),
      createTextElement("dd", "", value),
    );
  });

  const nextProject = projects[(projectIndex + 1) % projects.length];
  const nextLink = getElement("[data-next-project]");
  nextLink.href = projectPath(nextProject.slug);
  getElement("[data-next-title]").textContent = nextProject.title;
}

async function initialize() {
  try {
    document.querySelectorAll("[data-site-home]").forEach((link) => {
      link.setAttribute("href", sitePath("/"));
    });
    const projects = await loadProjects();
    if (document.body.dataset.page === "project") {
      initializeProjectPage(projects);
      return;
    }

    initializeHome(projects);
  } catch (error) {
    console.error(error);
    const errorElement = document.querySelector(
      document.body.dataset.page === "project" ? "[data-detail-message]" : "[data-load-error]",
    );
    if (errorElement instanceof HTMLElement) {
      errorElement.textContent = "Projects could not be loaded. Please try again later.";
      errorElement.hidden = false;
    }
  }
}

initialize();
