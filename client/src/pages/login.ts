import { apiPost } from "../lib/api-client";

export function mountLogin(root: HTMLElement) {
  root.innerHTML = `
    <section class="page login-page">
      <h2>Sign in</h2>
      <p class="muted">Use your Odoo username and password.</p>

      <form id="login-form">
        <label>Username</label>
        <input id="login-username" type="text" autocomplete="username" autocapitalize="off" required />

        <label>Password</label>
        <input id="login-password" type="password" autocomplete="current-password" required />

        <div id="login-error"></div>

        <button id="login-submit" type="submit" class="btn-primary">Sign in</button>
      </form>
    </section>
  `;

  const form = root.querySelector<HTMLFormElement>("#login-form")!;
  const usernameInput = root.querySelector<HTMLInputElement>("#login-username")!;
  const passwordInput = root.querySelector<HTMLInputElement>("#login-password")!;
  const errorEl = root.querySelector<HTMLDivElement>("#login-error")!;
  const submitBtn = root.querySelector<HTMLButtonElement>("#login-submit")!;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errorEl.textContent = "";
    submitBtn.disabled = true;
    submitBtn.textContent = "Signing in…";
    try {
      await apiPost("/auth/login", {
        login: usernameInput.value.trim(),
        password: passwordInput.value,
      });
      window.location.hash = "/dashboard";
      window.location.reload();
    } catch {
      errorEl.innerHTML = `<p class="error">Invalid username or password.</p>`;
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "Sign in";
    }
  });

  usernameInput.focus();
}
