const topNavigation = document.querySelector(".top");
const main = document.querySelector("main");
const sectionRecords = Array.from(main?.querySelectorAll(":scope > section") ?? [])
  .map((section) => {
    const heading = section.querySelector("h2");
    if (!heading) return null;

    const label = heading.textContent.replace(/^\s*\d+\s*/, "").trim();
    const slug = label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    section.id ||= slug;
    return { section, label };
  })
  .filter(Boolean);

if (topNavigation && main && sectionRecords.length) {
  const contents = document.createElement("nav");
  contents.className = "article-contents";
  contents.setAttribute("aria-label", "On this page");

  const details = document.createElement("details");
  const summary = document.createElement("summary");
  const summaryLabel = document.createElement("span");
  const currentLabel = document.createElement("small");
  const disclosure = document.createElement("span");
  summaryLabel.textContent = "On this page";
  currentLabel.textContent = "Introduction";
  disclosure.className = "contents-disclosure";
  disclosure.setAttribute("aria-hidden", "true");
  summary.append(summaryLabel, currentLabel, disclosure);

  const list = document.createElement("ol");
  sectionRecords.forEach(({ section, label }) => {
    const item = document.createElement("li");
    const link = document.createElement("a");
    link.href = `#${section.id}`;
    link.textContent = label;
    item.append(link);
    list.append(item);
  });

  details.append(summary, list);
  contents.append(details);
  main.before(contents);

  const progress = document.createElement("span");
  const progressValue = document.createElement("span");
  progress.className = "reading-progress";
  progress.setAttribute("aria-hidden", "true");
  progress.append(progressValue);
  topNavigation.append(progress);

  let updatePending = false;
  const updateReadingState = () => {
    const maximum = document.documentElement.scrollHeight - window.innerHeight;
    const fraction = maximum > 0 ? Math.min(1, Math.max(0, window.scrollY / maximum)) : 0;
    progressValue.style.transform = `scaleX(${fraction})`;

    const threshold = window.innerHeight * 0.32;
    let current = "Introduction";
    for (const record of sectionRecords) {
      if (record.section.getBoundingClientRect().top <= threshold) current = record.label;
    }
    currentLabel.textContent = current;
    updatePending = false;
  };

  const requestReadingUpdate = () => {
    if (updatePending) return;
    updatePending = true;
    requestAnimationFrame(updateReadingState);
  };

  window.addEventListener("scroll", requestReadingUpdate, { passive: true });
  window.addEventListener("resize", requestReadingUpdate, { passive: true });
  updateReadingState();
}
