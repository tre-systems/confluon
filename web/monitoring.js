let sentry;
let monitoringReady = false;

function runtimeConfig() {
  return window.CONFLUON_RUNTIME_CONFIG || {};
}

function scrubUrl(value) {
  if (!value || typeof value !== "string") return value;
  try {
    const url = new URL(value, window.location.origin);
    url.search = "";
    url.hash = "";
    return url.href;
  } catch {
    return value.split(/[?#]/, 1)[0];
  }
}

function scrubPossibleUrl(value) {
  if (
    typeof value !== "string" ||
    (!/^https?:\/\//.test(value) && !value.startsWith("/"))
  ) {
    return value;
  }
  return scrubUrl(value);
}

function scrubEvent(event) {
  if (event.request) {
    event.request.url = scrubUrl(event.request.url);
    delete event.request.query_string;
    delete event.request.cookies;
    delete event.request.data;
    if (event.request.headers) {
      for (const key of Object.keys(event.request.headers)) {
        if (/authorization|cookie/i.test(key)) event.request.headers[key] = "[Filtered]";
      }
    }
  }
  event.transaction = scrubPossibleUrl(event.transaction);
  for (const span of event.spans || []) {
    if (
      typeof span.description === "string" &&
      (/^https?:\/\//.test(span.description) || span.description.startsWith("/"))
    ) {
      span.description = scrubPossibleUrl(span.description);
    }
    if (!span.data) continue;
    for (const key of Object.keys(span.data)) {
      if (/url|from|to|location/i.test(key) && typeof span.data[key] === "string") {
        span.data[key] = scrubUrl(span.data[key]);
      }
    }
  }
  delete event.user;
  delete event.extra;
  event.tags = { ...event.tags, app: "confluon" };
  return event;
}

function scrubBreadcrumb(breadcrumb) {
  if (breadcrumb.data?.url) breadcrumb.data.url = scrubUrl(breadcrumb.data.url);
  if (breadcrumb.data?.from) breadcrumb.data.from = scrubUrl(breadcrumb.data.from);
  if (breadcrumb.data?.to) breadcrumb.data.to = scrubUrl(breadcrumb.data.to);
  return breadcrumb;
}

export async function initializeMonitoring() {
  const config = runtimeConfig();
  if (!config.sentryDsn) return false;
  if (navigator.onLine === false) {
    window.addEventListener("online", () => void initializeMonitoring(), { once: true });
    return false;
  }

  try {
    sentry = await import("@sentry/browser");
    const integrations = [];
    const feedback = sentry.feedbackIntegration({
      autoInject: false,
      colorScheme: "dark",
      enableScreenshot: false,
      showBranding: false,
      showEmail: false,
      showName: false,
      submitButtonLabel: "Send feedback",
      formTitle: "Send feedback",
      messagePlaceholder: "What is working, what is broken, or what would you love to see?",
    });
    integrations.push(feedback);
    if (typeof sentry.browserTracingIntegration === "function") {
      integrations.push(
        sentry.browserTracingIntegration({
          enableInp: true,
          instrumentNavigation: true,
          instrumentPageLoad: true,
        }),
      );
    }

    const configuredRate = Number(config.sentryTracesSampleRate);
    const tracesSampleRate =
      Number.isFinite(configuredRate) && configuredRate >= 0 && configuredRate <= 1
        ? configuredRate
        : config.environment === "production"
          ? 0.05
          : 0;

    sentry.init({
      dsn: config.sentryDsn,
      environment: config.environment || "production",
      release: config.release || undefined,
      sendDefaultPii: false,
      tracesSampleRate,
      replaysSessionSampleRate: 0,
      replaysOnErrorSampleRate: 0,
      integrations,
      beforeBreadcrumb: scrubBreadcrumb,
      beforeSend: scrubEvent,
      beforeSendTransaction: scrubEvent,
      ignoreErrors: [
        "ResizeObserver loop completed with undelivered notifications",
        "ResizeObserver loop limit exceeded",
      ],
    });
    monitoringReady = true;

    const button = document.querySelector("#feedback-button");
    if (button) {
      try {
        feedback.attachTo(button);
        button.hidden = false;
      } catch {
        // Diagnostics remain useful even if this SDK/browser cannot mount Feedback.
      }
    }
    return true;
  } catch (error) {
    console.warn("Diagnostics could not start", error);
    sentry = undefined;
    monitoringReady = false;
    return false;
  }
}

export function captureException(error, context = {}) {
  if (!monitoringReady || !sentry) return;
  sentry.withScope((scope) => {
    scope.setContext("confluon", context);
    sentry.captureException(error);
  });
}

export function captureMessage(message, context = {}, level = "error") {
  if (!monitoringReady || !sentry) return;
  sentry.withScope((scope) => {
    scope.setContext("confluon", context);
    sentry.captureMessage(message, level);
  });
}

export function setRuntimeTag(key, value) {
  if (!monitoringReady || !sentry) return;
  sentry.setTag(key, String(value));
}
