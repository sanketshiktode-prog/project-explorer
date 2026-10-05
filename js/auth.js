/* auth.js — PROTOTYPE authentication.
   Passwords are stored as salted PBKDF2-SHA256 hashes in data/users.json and checked
   in the browser. Suitable for a controlled internal prototype only — anyone who can
   read the repo/site files can read the data JSON directly. Not production security. */
let SESSION = null;

function currentUser() {
  if (SESSION) return SESSION;
  try { SESSION = JSON.parse(sessionStorage.getItem('pe_session')); } catch (e) { SESSION = null; }
  return SESSION;
}
function hasRole(...roles) { const u = currentUser(); return !!u && roles.includes(u.role); }
function logout() { SESSION = null; try { sessionStorage.removeItem('pe_session'); } catch (e) { } location.hash = '#/login'; }

async function login(userId, password) {
  const u = DB.users.find(x => x.user_id.toLowerCase() === String(userId).trim().toLowerCase());
  if (!u) return 'Invalid user ID or password';
  const h = await hashPassword(password, u.salt);
  if (h !== u.hash) return 'Invalid user ID or password';
  if (u.active === false) return 'This account is disabled. Contact the Admin.';
  SESSION = { user_id: u.user_id, display_name: u.display_name, role: u.role };
  try { sessionStorage.setItem('pe_session', JSON.stringify(SESSION)); } catch (e) { }
  return null;
}

function renderLogin(main) {
  main.innerHTML = `<div class="login"><form id="lf" class="login-box">
    <h1>${esc(DB['master-data'].settings.app_title)}</h1><p class="muted">Sign in to continue</p>
    <label>User ID<input name="u" autocomplete="username" required autofocus></label>
    <label>Password<input name="p" type="password" autocomplete="current-password" required></label>
    <div class="err" id="lerr"></div>
    <button class="btn primary" type="submit">Login</button>
    <p class="fine">Prototype authentication — suitable for controlled internal prototype use, not production security.</p>
  </form></div>`;
  $('#lf').onsubmit = async e => {
    e.preventDefault();
    const f = e.target, btn = $('button', f);
    btn.disabled = true; $('#lerr').textContent = '';
    try {
      const err = await login(f.u.value, f.p.value);
      if (err) { $('#lerr').textContent = err; btn.disabled = false; return; }
      location.hash = '#/dashboard';
    } catch (x) {
      $('#lerr').textContent = 'Login needs a secure page (https:// or localhost). ' + x.message; btn.disabled = false;
    }
  };
}
