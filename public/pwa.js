import {
  activateWaitingServiceWorker,
  checkForServiceWorkerUpdate,
  installUpdateCheckTriggers,
  SERVICE_WORKER_OPTIONS,
  SERVICE_WORKER_URL,
  shouldCheckForUpdate,
} from "/pwa-update.js";

function showUpdatePrompt(registration) {
  if (document.querySelector("#confluon-update")) return;

  const style = document.createElement("style");
  style.textContent = `
    #confluon-update{position:fixed;z-index:1000;right:max(14px,env(safe-area-inset-right));bottom:max(14px,env(safe-area-inset-bottom));display:flex;align-items:center;gap:9px;padding:9px 10px 9px 13px;border:1px solid rgba(226,232,224,.16);border-radius:999px;background:rgba(7,10,14,.88);color:#aeb1ae;font:9px/1.2 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.08em;box-shadow:0 12px 35px rgba(0,0,0,.3);backdrop-filter:blur(16px)}
    #confluon-update button{min-height:28px;padding:4px 10px;border:1px solid rgba(226,232,224,.14);border-radius:999px;background:rgba(226,232,224,.05);color:#dfe6df;font:inherit;cursor:pointer}
    #confluon-update button:hover,#confluon-update button:focus-visible{border-color:rgba(226,232,224,.4);outline:none}
    #confluon-update .later{padding-inline:7px;border-color:transparent;color:#7f8581;background:transparent}
  `;
  const prompt = document.createElement("div");
  prompt.id = "confluon-update";
  prompt.setAttribute("role", "status");
  prompt.innerHTML =
    '<span>Update ready</span><button type="button" class="apply">Restart</button><button type="button" class="later" aria-label="Use this version for now">Later</button>';
  prompt.querySelector(".apply").addEventListener("click", () => {
    if (registration.waiting) activateWaitingServiceWorker(registration.waiting);
  });
  prompt.querySelector(".later").addEventListener("click", () => prompt.remove());
  document.head.append(style);
  document.body.append(prompt);
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", async () => {
    try {
      const registration = await navigator.serviceWorker.register(
        SERVICE_WORKER_URL,
        SERVICE_WORKER_OPTIONS,
      );
      let checking = false;
      let lastCheckAt = 0;
      const check = async (force = false) => {
        if (
          checking ||
          !navigator.onLine ||
          document.visibilityState !== "visible" ||
          (!force && !shouldCheckForUpdate(Date.now(), lastCheckAt))
        ) {
          return;
        }
        checking = true;
        lastCheckAt = Date.now();
        try {
          await checkForServiceWorkerUpdate(registration);
          if (registration.waiting && navigator.serviceWorker.controller) {
            showUpdatePrompt(registration);
          }
        } catch {
          // Offline use and the instrument itself do not depend on update checks.
        } finally {
          checking = false;
        }
      };

      installUpdateCheckTriggers(() => void check());
      if (registration.waiting && navigator.serviceWorker.controller) {
        showUpdatePrompt(registration);
      }
      registration.addEventListener("updatefound", () => {
        const installing = registration.installing;
        if (!installing) return;
        installing.addEventListener("statechange", () => {
          if (installing.state === "installed" && navigator.serviceWorker.controller) {
            showUpdatePrompt(registration);
          }
        });
      });
      await check(true);
    } catch (error) {
      console.warn("Offline support could not start", error);
    }
  });
}
