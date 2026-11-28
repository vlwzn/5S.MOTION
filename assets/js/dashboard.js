const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const allowedExtensions = new Set(["png", "jpg", "jpeg", "gif", "mp4", "webm", "mov"]);
const maxFileSize = 64 * 1024 * 1024;
const siteContentFields = {
  about: [
    "eyebrow",
    "title",
    "intro",
    "locationLabel",
    "location",
    "practiceLabel",
    "practice",
    "disciplinesLabel",
    "disciplines",
    "approachLabel",
    "approach",
    "servicesLabel",
    "services",
    "footerCta",
  ],
  contact: [
    "eyebrow",
    "title",
    "businessLabel",
    "businessDescription",
    "email",
    "studioLabel",
    "studioLocation",
    "footerCta",
  ],
};
const form = document.querySelector("[data-project-form]");
const editor = document.querySelector("[data-editor]");
const contentEditor = document.querySelector("[data-content-editor]");
const contentForm = document.querySelector("[data-content-form]");
const fontEditor = document.querySelector("[data-font-editor]");
const fontForm = document.querySelector("[data-font-form]");
const emptyState = document.querySelector("[data-empty-state]");
const projectList = document.querySelector("[data-project-list]");
const status = document.querySelector("[data-save-status]");
const toast = document.querySelector("[data-toast]");
const fileInput = document.querySelector("[data-media-input]");
const formFeedback = document.querySelector("[data-form-feedback]");
const contentFeedback = document.querySelector("[data-content-feedback]");
const fontFeedback = document.querySelector("[data-font-feedback]");

let projects = [];
let siteContent = null;
let siteSettings = null;
let currentProject = null;
let currentContentPage = null;
let isCreating = false;
let isDirty = false;
let isContentDirty = false;
let isFontsDirty = false;
let draggedProjectLink = null;
let draggedProjectItems = [];
let projectDropHandled = false;
let toastTimeout;

function showToast(message, isError = false) {
  clearTimeout(toastTimeout);
  toast.textContent = message;
  toast.classList.toggle("is-error", isError);
  toast.classList.add("is-visible");
  toastTimeout = setTimeout(() => toast.classList.remove("is-visible"), 3200);
}

function setStatus(message, isError = false) {
  status.textContent = message;
  status.classList.toggle("is-error", isError);
}

async function apiRequest(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...(options.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...options.headers,
    },
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(result.error || `Permintaan gagal (${response.status}).`);
  }
  return result;
}

function applySiteFonts(settings) {
  document.documentElement.style.setProperty(
    "--serif",
    `"${settings.headingFont}", Georgia, serif`,
  );
  document.documentElement.style.setProperty(
    "--sans",
    `"${settings.bodyFont}", Arial, sans-serif`,
  );
  const fontUrl = new URL("https://fonts.googleapis.com/css2");
  [settings.headingFont, settings.bodyFont, "DM Mono"].forEach((family) => {
    fontUrl.searchParams.append("family", family);
  });
  fontUrl.searchParams.set("display", "swap");
  let fontStylesheet = document.querySelector("[data-site-fonts]");
  if (!(fontStylesheet instanceof HTMLLinkElement)) {
    fontStylesheet = document.createElement("link");
    fontStylesheet.rel = "stylesheet";
    fontStylesheet.dataset.siteFonts = "true";
    document.head.append(fontStylesheet);
  }
  fontStylesheet.href = fontUrl.href;
}

function getMediaSource(media) {
  return media.src || media.image || "";
}

function getMediaType(media) {
  if (media.type) {
    return media.type;
  }
  return /\.(?:mp4|webm|mov)$/i.test(getMediaSource(media)) ? "video" : "image";
}

function mediaFileName(media) {
  return media.name || getMediaSource(media).split("/").pop() || "Project media";
}

function renderProjectList() {
  projectList.replaceChildren();
  projects.forEach((project, index) => {
    const button = document.createElement("button");
    button.className = "dashboard-project-link";
    button.type = "button";
    button.draggable = true;
    button.dataset.projectSlug = project.slug;
    button.classList.toggle("is-active", currentProject?.slug === project.slug);
    button.addEventListener("click", () => selectProject(project.slug));

    const number = document.createElement("span");
    number.className = "dashboard-project-number";
    number.textContent = String(index + 1).padStart(2, "0");
    const name = document.createElement("span");
    name.className = "dashboard-project-name";
    name.textContent = project.title;
    const year = document.createElement("span");
    year.className = "dashboard-project-year";
    year.textContent = project.year;
    button.append(number, name, year);
    projectList.append(button);
  });
}

function confirmDiscardChanges() {
  return (
    (!isDirty && !isContentDirty && !isFontsDirty) ||
    window.confirm("Perubahan belum disimpan. Buang perubahan dan lanjutkan?")
  );
}

function fillContentForm(page) {
  const activeGroup = contentEditor.querySelector(`[data-content-fields="${page}"]`);
  contentEditor.querySelectorAll("[data-content-fields]").forEach((group) => {
    const isActive = group === activeGroup;
    group.hidden = !isActive;
    group.querySelectorAll("input, textarea").forEach((field) => {
      field.disabled = !isActive;
    });
  });
  siteContentFields[page].forEach((fieldName) => {
    const field = activeGroup.querySelector(`[name="${fieldName}"]`);
    field.value = siteContent[page][fieldName] || "";
  });
  document.querySelector("[data-content-editor-kicker]").textContent =
    page === "about" ? "About" : "Contact";
  document.querySelector("[data-content-editor-title]").textContent =
    `Edit ${page === "about" ? "About" : "Contact"}`;
  contentFeedback.textContent = "";
  document.querySelectorAll("[data-content-tab]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.contentTab === page));
  });
  document.querySelector("[data-settings-tab]").setAttribute("aria-pressed", "false");
}

function selectContent(page) {
  if (!confirmDiscardChanges()) {
    return;
  }
  currentProject = null;
  currentContentPage = page;
  isCreating = false;
  isDirty = false;
  isContentDirty = false;
  isFontsDirty = false;
  emptyState.hidden = true;
  editor.hidden = true;
  contentEditor.hidden = false;
  fontEditor.hidden = true;
  fillContentForm(page);
  renderProjectList();
  setStatus("Tersimpan");
  history.replaceState(null, "", `/dashboard?content=${page}`);
}

function selectFontSettings() {
  if (!confirmDiscardChanges()) {
    return;
  }
  currentProject = null;
  currentContentPage = null;
  isCreating = false;
  isDirty = false;
  isContentDirty = false;
  isFontsDirty = false;
  emptyState.hidden = true;
  editor.hidden = true;
  contentEditor.hidden = true;
  fontEditor.hidden = false;
  fontForm.elements.namedItem("headingFont").value = siteSettings.headingFont;
  fontForm.elements.namedItem("bodyFont").value = siteSettings.bodyFont;
  fontFeedback.textContent = "";
  document.querySelectorAll("[data-content-tab]").forEach((button) => {
    button.setAttribute("aria-pressed", "false");
  });
  document.querySelector("[data-settings-tab]").setAttribute("aria-pressed", "true");
  setStatus("Tersimpan");
  history.replaceState(null, "", "/dashboard?settings=fonts");
}

async function saveProjectOrder() {
  const previousProjects = [...projects];
  const orderedSlugs = [...projectList.children].map((item) => item.dataset.projectSlug);
  const projectBySlug = new Map(projects.map((project) => [project.slug, project]));
  projects = orderedSlugs.map((slug) => projectBySlug.get(slug));
  renderProjectList();
  setStatus("Menyimpan urutan...");

  try {
    await apiRequest("/api/projects/order", {
      method: "PUT",
      body: JSON.stringify({ slugs: orderedSlugs }),
    });
    setStatus(isDirty ? "Perubahan belum disimpan" : "Urutan tersimpan");
    showToast("Urutan project tersimpan.");
  } catch (error) {
    console.error(error);
    projects = previousProjects;
    renderProjectList();
    setStatus("Gagal menyimpan urutan", true);
    showToast(error.message, true);
  }
}

projectList.addEventListener("dragstart", (event) => {
  const projectLink = event.target.closest(".dashboard-project-link");
  if (!projectLink) {
    return;
  }
  draggedProjectLink = projectLink;
  draggedProjectItems = [...projectList.children];
  projectDropHandled = false;
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", projectLink.dataset.projectSlug);
  projectLink.classList.add("is-dragging");
});

projectList.addEventListener("dragover", (event) => {
  event.preventDefault();
  if (!draggedProjectLink) {
    return;
  }

  const target = event.target.closest(".dashboard-project-link");
  if (!target || target === draggedProjectLink) {
    return;
  }

  const bounds = target.getBoundingClientRect();
  const insertBeforeTarget = event.clientY < bounds.top + bounds.height / 2;
  projectList.insertBefore(
    draggedProjectLink,
    insertBeforeTarget ? target : target.nextSibling,
  );
});

projectList.addEventListener("drop", (event) => {
  event.preventDefault();
  if (draggedProjectLink) {
    projectDropHandled = true;
    void saveProjectOrder();
  }
});

projectList.addEventListener("dragend", () => {
  if (!projectDropHandled) {
    draggedProjectItems.forEach((item) => projectList.append(item));
  }
  draggedProjectLink?.classList.remove("is-dragging");
  draggedProjectLink = null;
  draggedProjectItems = [];
  projectDropHandled = false;
});

function fillForm(project) {
  form.elements.namedItem("title").value = project.title || "";
  form.elements.namedItem("slug").value = project.slug || "";
  form.elements.namedItem("year").value = project.year || "";
  form.elements.namedItem("client").value = project.client || "";
  form.elements.namedItem("studio").value = project.studio || "5S.MOTION";
  form.elements.namedItem("description").value = project.description || "";
  form.elements.namedItem("slug").readOnly = !isCreating;
  delete form.elements.namedItem("slug").dataset.edited;
  document.querySelector("[data-editor-kicker]").textContent = isCreating
    ? "Project / Baru"
    : `Project / ${project.slug}`;
  document.querySelector("[data-editor-title]").textContent = project.title || "Project baru";
  document.querySelector("[data-delete-project]").hidden = isCreating;
  document.querySelector("[data-save-project]").textContent = isCreating
    ? "Buat project"
    : "Simpan perubahan";
  fileInput.disabled = isCreating;
  formFeedback.textContent = isCreating ? "Simpan project sebelum menambahkan media." : "";
}

function renderMedia() {
  const mediaGrid = document.querySelector("[data-media-grid]");
  const emptyMedia = document.querySelector("[data-empty-media]");
  mediaGrid.replaceChildren();
  const gallery = currentProject?.gallery || [];

  gallery.forEach((media) => {
    const source = getMediaSource(media);
    const type = getMediaType(media);
    const coverMedia = currentProject.image
      ? gallery.find((item) => getMediaSource(item) === currentProject.image)
      : gallery[0];
    const isCover = coverMedia === media;
    const card = document.createElement("article");
    card.className = "media-card";

    const preview = document.createElement("div");
    preview.className = "media-preview";
    if (type === "video") {
      const video = document.createElement("video");
      video.src = source;
      video.controls = true;
      video.preload = "metadata";
      video.playsInline = true;
      video.setAttribute("aria-label", media.alt || mediaFileName(media));
      preview.append(video);
      const videoBadge = document.createElement("span");
      videoBadge.className = "media-video-badge";
      videoBadge.textContent = "Video";
      preview.append(videoBadge);
    } else {
      const image = document.createElement("img");
      image.src = source;
      image.alt = media.alt || mediaFileName(media);
      image.loading = "lazy";
      preview.append(image);
    }

    if (isCover) {
      const coverBadge = document.createElement("span");
      coverBadge.className = "media-cover-badge";
      coverBadge.textContent = "Homepage";
      preview.append(coverBadge);
    }

    const cardInfo = document.createElement("div");
    cardInfo.className = "media-card-info";
    const filename = document.createElement("span");
    filename.className = "media-filename";
    filename.textContent = mediaFileName(media);
    filename.title = mediaFileName(media);

    const actions = document.createElement("div");
    actions.className = "media-card-actions";
    if (!isCover) {
      const coverButton = document.createElement("button");
      coverButton.className = "media-cover-button";
      coverButton.type = "button";
      coverButton.textContent = "Pakai di home";
      coverButton.addEventListener("click", () => setCover(source, media.alt || currentProject.title));
      actions.append(coverButton);
    }

    const deleteButton = document.createElement("button");
    deleteButton.className = "media-delete-button";
    deleteButton.type = "button";
    deleteButton.textContent = "Hapus";
    deleteButton.disabled = !source.startsWith(`/uploads/${currentProject.slug}/`);
    if (deleteButton.disabled) {
      deleteButton.title = "Media bawaan tidak dapat dihapus.";
    }
    deleteButton.addEventListener("click", () => deleteMedia(media));
    actions.append(deleteButton);
    cardInfo.append(filename, actions);
    card.append(preview, cardInfo);
    mediaGrid.append(card);
  });

  emptyMedia.classList.toggle("is-visible", gallery.length === 0);
  emptyMedia.textContent = isCreating
    ? "Simpan project sebelum menambahkan foto atau video."
    : "Belum ada media. Tambahkan foto atau video untuk memulai.";
}

function selectProject(slug) {
  if (!confirmDiscardChanges()) {
    return;
  }

  const project = projects.find((entry) => entry.slug === slug);
  if (!project) {
    return;
  }
  currentProject = project;
  currentContentPage = null;
  isCreating = false;
  isDirty = false;
  isContentDirty = false;
  isFontsDirty = false;
  emptyState.hidden = true;
  editor.hidden = false;
  contentEditor.hidden = true;
  fontEditor.hidden = true;
  fillForm(project);
  renderMedia();
  renderProjectList();
  setStatus("Tersimpan");
}

function slugify(value) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

function startNewProject() {
  if (!confirmDiscardChanges()) {
    return;
  }
  currentProject = {
    slug: "",
    title: "",
    year: String(new Date().getFullYear()),
    client: "",
    studio: "5S.MOTION",
    description: "",
    image: "",
    imageAlt: "",
    gallery: [],
  };
  currentContentPage = null;
  isCreating = true;
  isDirty = false;
  isContentDirty = false;
  isFontsDirty = false;
  emptyState.hidden = true;
  editor.hidden = false;
  contentEditor.hidden = true;
  fontEditor.hidden = true;
  fillForm(currentProject);
  renderMedia();
  renderProjectList();
  form.elements.namedItem("title").focus();
  setStatus("Project baru");
}

function readForm(slug) {
  return {
    slug,
    title: form.elements.namedItem("title").value.trim(),
    year: form.elements.namedItem("year").value.trim(),
    client: form.elements.namedItem("client").value.trim(),
    studio: form.elements.namedItem("studio").value.trim(),
    description: form.elements.namedItem("description").value.trim(),
    image: currentProject.image || "",
    imageAlt: currentProject.imageAlt || form.elements.namedItem("title").value.trim(),
  };
}

async function saveProject(event) {
  event.preventDefault();
  if (!form.reportValidity()) {
    return;
  }

  const title = form.elements.namedItem("title").value.trim();
  const slugInput = form.elements.namedItem("slug");
  const slug = (slugInput.value.trim() || slugify(title)).toLowerCase();
  slugInput.value = slug;
  if (!slugPattern.test(slug)) {
    slugInput.setCustomValidity("Gunakan huruf kecil, angka, dan tanda hubung.");
    slugInput.reportValidity();
    slugInput.setCustomValidity("");
    return;
  }

  const saveButton = document.querySelector("[data-save-project]");
  const creatingProject = isCreating;
  saveButton.disabled = true;
  formFeedback.textContent = "";
  setStatus("Menyimpan...");
  try {
    const payload = readForm(slug);
    const savedProject = isCreating
      ? await apiRequest("/api/projects", { method: "POST", body: JSON.stringify(payload) })
      : await apiRequest(`/api/projects/${encodeURIComponent(currentProject.slug)}`, {
          method: "PUT",
          body: JSON.stringify(payload),
        });

    const existingIndex = projects.findIndex((entry) => entry.slug === savedProject.slug);
    if (existingIndex < 0) {
      projects.push(savedProject);
    } else {
      projects[existingIndex] = savedProject;
    }
    currentProject = savedProject;
    isCreating = false;
    isDirty = false;
    fillForm(savedProject);
    renderMedia();
    renderProjectList();
    setStatus("Tersimpan");
    showToast(creatingProject ? "Project berhasil dibuat." : "Project berhasil disimpan.");
    history.replaceState(null, "", `/dashboard?project=${encodeURIComponent(savedProject.slug)}`);
  } catch (error) {
    console.error(error);
    formFeedback.textContent = error.message;
    setStatus("Gagal menyimpan", true);
  } finally {
    saveButton.disabled = false;
  }
}

async function saveSiteContent(event) {
  event.preventDefault();
  if (!currentContentPage || !contentForm.reportValidity()) {
    return;
  }

  const activeGroup = contentEditor.querySelector(
    `[data-content-fields="${currentContentPage}"]`,
  );
  const payload = Object.fromEntries(
    siteContentFields[currentContentPage].map((fieldName) => [
      fieldName,
      activeGroup.querySelector(`[name="${fieldName}"]`).value.trim(),
    ]),
  );
  const saveButton = document.querySelector("[data-save-content]");
  saveButton.disabled = true;
  contentFeedback.textContent = "";
  setStatus("Menyimpan konten...");
  try {
    const result = await apiRequest(`/api/site-content/${currentContentPage}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    });
    siteContent[currentContentPage] = result.content;
    isContentDirty = false;
    fillContentForm(currentContentPage);
    setStatus("Tersimpan");
    showToast(`Konten ${currentContentPage === "about" ? "About" : "Contact"} berhasil disimpan.`);
  } catch (error) {
    console.error(error);
    contentFeedback.textContent = error.message;
    setStatus("Gagal menyimpan konten", true);
  } finally {
    saveButton.disabled = false;
  }
}

async function saveSiteFonts(event) {
  event.preventDefault();
  if (!fontForm.reportValidity()) {
    return;
  }

  const settings = {
    headingFont: fontForm.elements.namedItem("headingFont").value.trim(),
    bodyFont: fontForm.elements.namedItem("bodyFont").value.trim(),
  };
  const saveButton = document.querySelector("[data-save-fonts]");
  saveButton.disabled = true;
  fontFeedback.textContent = "";
  setStatus("Menyimpan font...");
  try {
    siteSettings = await apiRequest("/api/site-settings", {
      method: "PUT",
      body: JSON.stringify(settings),
    });
    applySiteFonts(siteSettings);
    isFontsDirty = false;
    fontForm.elements.namedItem("headingFont").value = siteSettings.headingFont;
    fontForm.elements.namedItem("bodyFont").value = siteSettings.bodyFont;
    setStatus("Tersimpan");
    showToast("Font website berhasil disimpan.");
  } catch (error) {
    console.error(error);
    fontFeedback.textContent = error.message;
    setStatus("Gagal menyimpan font", true);
  } finally {
    saveButton.disabled = false;
  }
}

function fileToBase64(file) {
  return file.arrayBuffer().then((buffer) => {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    const chunkSize = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
    }
    return btoa(binary);
  });
}

async function uploadMedia() {
  const files = [...fileInput.files];
  fileInput.value = "";
  if (!files.length || !currentProject || isCreating) {
    return;
  }

  const rejectedFiles = files.filter((file) => {
    const extension = file.name.split(".").pop()?.toLowerCase();
    return !allowedExtensions.has(extension) || file.size > maxFileSize;
  });
  if (rejectedFiles.length) {
    showToast(
      `${rejectedFiles.map((file) => file.name).join(", ")}: format tidak didukung atau file lebih dari 64 MB.`,
      true,
    );
    if (rejectedFiles.length === files.length) {
      return;
    }
  }
  const acceptedFiles = files.filter((file) => !rejectedFiles.includes(file));

  try {
    for (let offset = 0; offset < acceptedFiles.length; offset += 8) {
      const batch = acceptedFiles.slice(offset, offset + 8);
      setStatus(`Mengunggah ${Math.min(offset + batch.length, acceptedFiles.length)}/${acceptedFiles.length}...`);
      const payload = await Promise.all(
        batch.map(async (file) => ({
          name: file.name,
          alt: currentProject.title,
          data: await fileToBase64(file),
        })),
      );
      await apiRequest(`/api/projects/${encodeURIComponent(currentProject.slug)}/media`, {
        method: "POST",
        body: JSON.stringify({ files: payload }),
      });
    }

    projects = await apiRequest("/api/projects");
    currentProject = projects.find((project) => project.slug === currentProject.slug);
    renderMedia();
    renderProjectList();
    setStatus(isDirty ? "Perubahan belum disimpan" : "Tersimpan", false);
    showToast(`${acceptedFiles.length} media berhasil diunggah.`);
  } catch (error) {
    console.error(error);
    setStatus("Upload gagal", true);
    showToast(error.message, true);
    projects = await apiRequest("/api/projects");
    currentProject = projects.find((project) => project.slug === currentProject.slug);
    renderMedia();
  }
}

async function setCover(source, alt) {
  try {
    const payload = {
      slug: currentProject.slug,
      title: currentProject.title,
      year: currentProject.year,
      client: currentProject.client,
      studio: currentProject.studio,
      description: currentProject.description,
      image: source,
      imageAlt: alt,
    };
    const updatedProject = await apiRequest(`/api/projects/${encodeURIComponent(currentProject.slug)}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    });
    projects = projects.map((project) =>
      project.slug === updatedProject.slug ? updatedProject : project,
    );
    currentProject = updatedProject;
    renderMedia();
    setStatus(isDirty ? "Perubahan belum disimpan" : "Tersimpan");
    showToast("Media homepage berhasil diperbarui.");
  } catch (error) {
    console.error(error);
    showToast(error.message, true);
  }
}

async function deleteMedia(media) {
  const source = getMediaSource(media);
  const match = source.match(/^\/uploads\/([a-z0-9-]+)\/([a-z0-9-]+\.[a-z0-9]+)$/);
  if (!match) {
    showToast("Media bawaan tidak dapat dihapus dari dashboard.", true);
    return;
  }
  if (!window.confirm(`Hapus media "${mediaFileName(media)}"?`)) {
    return;
  }

  try {
    const [, slug, filename] = match;
    const updatedProject = await apiRequest(
      `/api/projects/${encodeURIComponent(slug)}/media/${encodeURIComponent(filename)}`,
      { method: "DELETE" },
    );
    projects = projects.map((project) =>
      project.slug === updatedProject.slug ? updatedProject : project,
    );
    currentProject = updatedProject;
    renderMedia();
    setStatus("Tersimpan");
    showToast("Media berhasil dihapus.");
  } catch (error) {
    console.error(error);
    showToast(error.message, true);
  }
}

async function deleteProject() {
  if (!currentProject || isCreating) {
    return;
  }
  if (!window.confirm(`Hapus project "${currentProject.title}" dari website?`)) {
    return;
  }

  try {
    await apiRequest(`/api/projects/${encodeURIComponent(currentProject.slug)}`, {
      method: "DELETE",
    });
    projects = projects.filter((project) => project.slug !== currentProject.slug);
    currentProject = null;
    isDirty = false;
    editor.hidden = true;
    renderProjectList();
    if (projects.length) {
      selectProject(projects[0].slug);
    } else {
      emptyState.hidden = false;
      setStatus("Project dihapus");
    }
    history.replaceState(null, "", "/dashboard");
    showToast("Project berhasil dihapus.");
  } catch (error) {
    console.error(error);
    showToast(error.message, true);
  }
}

form.addEventListener("input", (event) => {
  isDirty = true;
  setStatus("Perubahan belum disimpan");
  if (event.target.name === "title" && isCreating) {
    const slugField = form.elements.namedItem("slug");
    if (!slugField.dataset.edited) {
      slugField.value = slugify(event.target.value);
    }
  }
  if (event.target.name === "slug") {
    event.target.dataset.edited = "true";
  }
});
form.addEventListener("submit", saveProject);
contentForm.addEventListener("input", () => {
  isContentDirty = true;
  setStatus("Perubahan belum disimpan");
});
contentForm.addEventListener("submit", saveSiteContent);
fontForm.addEventListener("input", () => {
  isFontsDirty = true;
  setStatus("Perubahan belum disimpan");
});
fontForm.addEventListener("submit", saveSiteFonts);
fileInput.addEventListener("change", uploadMedia);
document.querySelector("[data-new-project]").addEventListener("click", startNewProject);
document.querySelector("[data-empty-new-project]").addEventListener("click", startNewProject);
document.querySelector("[data-delete-project]").addEventListener("click", deleteProject);
document.querySelectorAll("[data-content-tab]").forEach((button) => {
  button.addEventListener("click", () => selectContent(button.dataset.contentTab));
});
document.querySelector("[data-settings-tab]").addEventListener("click", selectFontSettings);

async function initializeDashboard() {
  try {
    const [loadedProjects, loadedContent, loadedSettings] = await Promise.all([
      apiRequest("/api/projects"),
      apiRequest("/api/site-content"),
      apiRequest("/api/site-settings"),
    ]);
    projects = loadedProjects;
    siteContent = loadedContent;
    siteSettings = loadedSettings;
    applySiteFonts(siteSettings);
    renderProjectList();
    if (new URLSearchParams(location.search).get("settings") === "fonts") {
      selectFontSettings();
      return;
    }

    const requestedContent = new URLSearchParams(location.search).get("content");
    if (requestedContent === "about" || requestedContent === "contact") {
      selectContent(requestedContent);
      return;
    }

    const requestedProject = new URLSearchParams(location.search).get("project");
    if (requestedProject && projects.some((project) => project.slug === requestedProject)) {
      selectProject(requestedProject);
    } else if (projects.length) {
      selectProject(projects[0].slug);
    } else {
      emptyState.hidden = false;
      setStatus("Belum ada project");
    }
  } catch (error) {
    console.error(error);
    setStatus("Gagal memuat project", true);
    showToast(error.message, true);
    emptyState.hidden = false;
  }
}

initializeDashboard();
