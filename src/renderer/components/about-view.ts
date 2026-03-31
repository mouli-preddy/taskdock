import { getIcon, Heart, Star, Sparkles, MessageSquare, ThumbsUp, Zap, Lightbulb, User } from '../utils/icons.js';

export class AboutView {
  private container: HTMLElement;
  private clickCount: number = 0;
  private konamiCode: string[] = [];
  private konamiSequence = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];
  private easterEggActive: boolean = false;
  private matrixInterval: number | null = null;

  constructor(containerId: string) {
    this.container = document.getElementById(containerId)!;
    this.render();
    this.attachEventListeners();
    this.setupKonamiCode();
    this.loadVersion();
  }

  private async loadVersion() {
    try {
      const { getVersion } = await import('@tauri-apps/api/app');
      const version = await getVersion();
      const el = this.container.querySelector('#aboutVersion') as HTMLElement;
      if (el) el.textContent = `v${version}`;
    } catch { /* stay as fallback */ }
  }

  private render() {
    this.container.innerHTML = `
      <div class="about-view">
        <div class="about-header">
          <h1 class="about-page-title">About TaskDock</h1>
        </div>

        <div class="about-content">
          <!-- Hero Section -->
          <div class="about-hero">
            <div class="about-logo" id="aboutLogo">
              <div class="logo-dock">
                <div class="dock-ship"></div>
                <div class="dock-crane"></div>
                <div class="dock-container c1"></div>
                <div class="dock-container c2"></div>
                <div class="dock-container c3"></div>
              </div>
              <div class="logo-sparkle s1">${getIcon(Sparkles, 16)}</div>
              <div class="logo-sparkle s2">${getIcon(Sparkles, 14)}</div>
              <div class="logo-sparkle s3">${getIcon(Zap, 12)}</div>
            </div>
            <div class="about-tagline">Where AI agents do the heavy lifting so you don't have to</div>
            <div class="about-version">
              <span id="aboutVersion">v0.0.6</span>
              &mdash; Beta (but like, a really good beta)
              <button class="btn btn-secondary" id="checkForUpdatesBtn" style="margin-left:12px;font-size:var(--text-xs);padding:2px 10px;height:auto;">Check for Updates</button>
              <span id="updateStatusMsg" style="font-size:var(--text-xs);color:var(--text-secondary);margin-left:8px;"></span>
            </div>
          </div>

          <!-- Creator Section -->
          <div class="about-section about-creator-section">
            <div class="creator-card">
              <div class="creator-avatar" id="creatorAvatar">
                <span class="avatar-letter">M</span>
                <div class="avatar-ring"></div>
              </div>
              <div class="creator-info">
                <h2 class="creator-name">Mouli Krishna</h2>
                <div class="creator-alias">(mouli)</div>
                <div class="creator-title">Main Contributor</div>
                <div class="creator-mission">"I built this app to have a scheduler and AI task executor that automatically triggers AI agents."</div>
              </div>
            </div>

            <div class="creator-card creator-card-secondary">
              <div class="creator-avatar creator-avatar-secondary">
                <span class="avatar-letter">K</span>
              </div>
              <div class="creator-info" style="font-size:var(--text-xs);color:var(--text-tertiary);">
                <span style="font-weight:600;color:var(--text-secondary);">Kiran</span>
                <span style="margin-left:4px;">(kirmadi)</span>
                <span style="margin-left:6px;font-style:italic;">Contributor</span>
              </div>
            </div>

            <div class="creator-quote" id="creatorQuote">
              <span class="quote-icon">${getIcon(Lightbulb, 20)}</span>
              <p>"I built this because AI should be in every part of the dev workflow, not just code completion. Welcome to the future."</p>
            </div>
          </div>

          <!-- Contact Section -->
          <div class="about-section about-contact-section">
            <h3 class="section-title">${getIcon(MessageSquare, 18)} Let's Chat!</h3>

            <div class="contact-cards">
              <div class="contact-card feedback-card" id="feedbackCard">
                <div class="contact-icon">${getIcon(MessageSquare, 24)}</div>
                <div class="contact-content">
                  <h4>Got Ideas? Found a Bug? Just Want to Say Hi?</h4>
                  <p>Slide into my Teams DMs - I promise I read them (eventually)</p>
                  <div class="teams-handle">
                    <span class="teams-icon">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M19.35 8.5H15.5c.28.57.5 1.15.5 1.8v4.7h2.35c.85 0 1.65-.35 2.25-.95.6-.6.9-1.35.9-2.2v-1.55c0-.95-.75-1.8-1.75-1.8h-.4zM16.5 6c0-1.1-.9-2-2-2s-2 .9-2 2 .9 2 2 2 2-.9 2-2zm-2.75 5h-4.5c-.95 0-1.75.75-1.75 1.75v5.5c0 .95.75 1.75 1.75 1.75h4.5c.95 0 1.75-.8 1.75-1.75v-5.5c0-1-.8-1.75-1.75-1.75zM11 9c1.65 0 3-1.35 3-3s-1.35-3-3-3-3 1.35-3 3 1.35 3 3 3z"/>
                      </svg>
                    </span>
                    <span class="handle-text">poreddy</span>
                  </div>
                </div>
              </div>

              <div class="contact-card kudos-card" id="kudosCard">
                <div class="contact-icon kudos-icon">${getIcon(Heart, 24)}</div>
                <div class="contact-content">
                  <h4>Love It? Like, REALLY Love It?</h4>
                  <p>Send Kudos on Teams and watch my ego inflate!</p>
                  <button class="kudos-btn" id="kudosBtn">
                    ${getIcon(ThumbsUp, 16)}
                    <span>How to Send Kudos</span>
                  </button>
                </div>
                <div class="kudos-hearts" id="kudosHearts"></div>
              </div>
            </div>
          </div>

          <!-- Share Section -->
          <div class="about-section about-share-section">
            <h3 class="section-title">${getIcon(Star, 18)} Spread the Good Word</h3>
            <div class="share-hero">
              <div class="share-emoji">🚀</div>
              <p class="share-headline">Got a dev friend still doing things the old way?</p>
              <p class="share-subtext">Don't let them suffer. PR review is just the appetizer!</p>
            </div>

            <div class="share-reasons">
              <div class="share-reason">
                <span class="reason-icon">🤖</span>
                <span>AI agents everywhere: PRs, work items, terminals... world domination next</span>
              </div>
              <div class="share-reason">
                <span class="reason-icon">🎯</span>
                <span>Your team will think you're a genius for finding this</span>
              </div>
              <div class="share-reason">
                <span class="reason-icon">☕</span>
                <span>They'll owe you coffee. Maybe lunch. Possibly their firstborn.</span>
              </div>
            </div>

            <div class="share-cta">
              <p class="share-how">
                <strong>The secret handshake:</strong> Tell them to message <span class="highlight">poreddy</span> on Teams!
              </p>
            </div>
          </div>

          <!-- Fun Facts Section -->
          <div class="about-section about-facts-section">
            <h3 class="section-title">${getIcon(Zap, 18)} Totally Real Statistics</h3>
            <div class="facts-grid">
              <div class="fact-card" id="fact1">
                <div class="fact-number">0</div>
                <div class="fact-label">Lines of code typed by human hands</div>
              </div>
              <div class="fact-card" id="fact2">
                <div class="fact-number">∞</div>
                <div class="fact-label">Times I said "okay, ONE more feature"</div>
              </div>
              <div class="fact-card" id="fact3">
                <div class="fact-number">0</div>
                <div class="fact-label">Agents harmed in the making of this app (that I know of)</div>
              </div>
              <div class="fact-card" id="fact4">
                <div class="fact-number">1</div>
                <div class="fact-label">Human just vibing and prompting</div>
              </div>
            </div>
          </div>

          <!-- Secret Section (hidden by default) -->
          <div class="about-section about-secret-section hidden" id="secretSection">
            <div class="secret-content">
              <h3>${getIcon(Sparkles, 20)} Well Well Well...</h3>
              <p>Look who's got too much time on their hands! (I respect it.)</p>
              <div class="secret-message">
                Achievement Unlocked: Professional Button Masher
              </div>
            </div>
          </div>

          <!-- Footer -->
          <div class="about-footer">
            <p>Made with ${getIcon(Heart, 14)}, mass prompting, and questionable life choices in 2026</p>
            <p class="footer-hint" id="footerHint">Psst... this page has secrets. Click around. Try the Konami code. Live a little.</p>
          </div>
        </div>

        <!-- Matrix Easter Egg Canvas -->
        <canvas id="matrixCanvas" class="matrix-canvas hidden"></canvas>
      </div>
    `;
  }

  private attachEventListeners() {
    // Logo click counter for easter egg
    const logo = this.container.querySelector('#aboutLogo');
    logo?.addEventListener('click', () => this.handleLogoClick());

    // Creator avatar click
    const avatar = this.container.querySelector('#creatorAvatar');
    avatar?.addEventListener('click', () => this.handleAvatarClick());

    // Quote click for random quotes
    const quote = this.container.querySelector('#creatorQuote');
    quote?.addEventListener('click', () => this.cycleQuote());

    // Kudos button
    const kudosBtn = this.container.querySelector('#kudosBtn');
    kudosBtn?.addEventListener('click', () => this.showKudosInstructions());

    // Kudos card hover
    const kudosCard = this.container.querySelector('#kudosCard');
    kudosCard?.addEventListener('mouseenter', () => this.spawnHearts());

    // Fact cards
    this.container.querySelectorAll('.fact-card').forEach((card, index) => {
      card.addEventListener('click', () => this.handleFactClick(index));
    });

    // Teams DM button
    const feedbackCard = this.container.querySelector('#feedbackCard');
    feedbackCard?.addEventListener('click', () => {
      window.electronAPI.openExternal('msteams://teams.microsoft.com/l/chat/0/0?users=poreddy@microsoft.com');
    });

    // Footer hint click
    const footerHint = this.container.querySelector('#footerHint');
    footerHint?.addEventListener('click', () => this.toggleSecretSection());

    // Check for updates
    this.container.querySelector('#checkForUpdatesBtn')?.addEventListener('click', async () => {
      const btn = this.container.querySelector('#checkForUpdatesBtn') as HTMLButtonElement;
      const msg = this.container.querySelector('#updateStatusMsg') as HTMLElement;
      btn.disabled = true;
      btn.textContent = 'Checking…';
      msg.textContent = '';
      try {
        const version = await window.electronAPI.checkForUpdate();
        if (version) {
          msg.textContent = `v${version} available — restart to install`;
          msg.style.color = 'var(--accent-primary)';
        } else {
          msg.textContent = 'You\'re on the latest version.';
          msg.style.color = 'var(--success, #107c10)';
        }
      } catch (err: any) {
        const detail = err?.message || String(err) || 'unknown error';
        msg.textContent = `Could not check for updates: ${detail}`;
        msg.style.color = 'var(--error, #c42b1c)';
        console.error('[updater]', err);
      } finally {
        btn.disabled = false;
        btn.textContent = 'Check for Updates';
      }
    });
  }

  private setupKonamiCode() {
    document.addEventListener('keydown', (e) => {
      this.konamiCode.push(e.key);
      this.konamiCode = this.konamiCode.slice(-10);

      if (this.konamiCode.join(',') === this.konamiSequence.join(',')) {
        this.activateMatrixMode();
      }
    });
  }

  private handleLogoClick() {
    this.clickCount++;
    const logo = this.container.querySelector('#aboutLogo');

    // Add bounce animation
    logo?.classList.add('bounce');
    setTimeout(() => logo?.classList.remove('bounce'), 300);

    // Easter eggs at different click counts
    if (this.clickCount === 5) {
      this.showToast('Ooh, a clicker! Keep going...');
    } else if (this.clickCount === 10) {
      this.showToast('Halfway to glory! Don\'t give up now.');
      logo?.classList.add('spin-slow');
    } else if (this.clickCount === 15) {
      this.showToast('So close I can taste it... wait, that\'s weird.');
      logo?.classList.add('rainbow');
    } else if (this.clickCount === 20) {
      this.showToast('🎉 YOU MADLAD! Achievement Unlocked!');
      this.unlockSecretSection();
      logo?.classList.add('mega-spin');
    }
  }

  private handleAvatarClick() {
    const avatar = this.container.querySelector('#creatorAvatar');
    avatar?.classList.add('wave');
    setTimeout(() => avatar?.classList.remove('wave'), 1000);

    const greetings = [
      'Hey there! 👋 Yes, I see you clicking.',
      'Thanks for checking out TaskDock! You have excellent taste.',
      'Yes, I click my own avatar too. We\'re not so different, you and I.',
      'You found me! Achievement unlocked: Curiosity.',
      'Go build something cool. Let the agents handle the boring stuff.',
      'Plot twist: This greeting was also written by an AI.',
    ];
    this.showToast(greetings[Math.floor(Math.random() * greetings.length)]);
  }

  private cycleQuote() {
    const quotes = [
      '"I built this because AI should be in every part of the dev workflow, not just code completion. Welcome to the future."',
      '"PRs, work items, terminals, planning - if it\'s boring, there\'s an agent for that."',
      '"Why click 10 times when you can click once? Big brain energy."',
      '"Built by a dev, for devs. No product managers were consulted. You\'re welcome."',
      '"The SDLC has too many manual steps. I took that personally."',
      '"Every developer deserves an AI army. This is step one of the revolution."',
      '"I didn\'t write this code. I just asked nicely and Claude delivered."',
    ];

    const quoteEl = this.container.querySelector('#creatorQuote p');
    if (quoteEl) {
      const currentIndex = quotes.findIndex(q => q === quoteEl.textContent);
      const nextIndex = (currentIndex + 1) % quotes.length;

      // Fade out, change, fade in
      quoteEl.classList.add('fade-out');
      setTimeout(() => {
        quoteEl.textContent = quotes[nextIndex];
        quoteEl.classList.remove('fade-out');
        quoteEl.classList.add('fade-in');
        setTimeout(() => quoteEl.classList.remove('fade-in'), 300);
      }, 300);
    }
  }

  private showKudosInstructions() {
    const modal = document.createElement('div');
    modal.className = 'kudos-modal';
    modal.innerHTML = `
      <div class="kudos-modal-content">
        <h3>${getIcon(Heart, 24)} How to Send Kudos</h3>
        <ol>
          <li>Open Microsoft Teams</li>
          <li>Search for <strong>poreddy</strong> (Mouli Krishna (poreddy))</li>
          <li>Click the <strong>...</strong> menu</li>
          <li>Select <strong>"Praise"</strong></li>
          <li>Pick a badge and write something nice!</li>
        </ol>
        <p class="kudos-note">Kudos are public recognition that show up on my profile. They really do make my day! 🎉</p>
        <button class="btn btn-primary kudos-close-btn">Got it!</button>
      </div>
    `;

    this.container.appendChild(modal);

    // Close on button click or backdrop click
    modal.querySelector('.kudos-close-btn')?.addEventListener('click', () => modal.remove());
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.remove();
    });

    // Animate in
    requestAnimationFrame(() => modal.classList.add('visible'));
  }

  private spawnHearts() {
    const container = this.container.querySelector('#kudosHearts');
    if (!container) return;

    for (let i = 0; i < 5; i++) {
      setTimeout(() => {
        const heart = document.createElement('div');
        heart.className = 'floating-heart';
        heart.innerHTML = getIcon(Heart, 16);
        heart.style.left = `${Math.random() * 80 + 10}%`;
        heart.style.animationDelay = `${Math.random() * 0.5}s`;
        container.appendChild(heart);

        setTimeout(() => heart.remove(), 2000);
      }, i * 100);
    }
  }

  private handleFactClick(index: number) {
    const card = this.container.querySelector(`#fact${index + 1}`);
    card?.classList.add('flip');
    setTimeout(() => card?.classList.remove('flip'), 600);

    // Secret messages on click
    const secrets = [
      'Okay fine... maybe a FEW prompts were typed 😉',
      'Currently at "just one more feature" attempt #847. Send help.',
      'Claude says hi! 🤖 (It\'s doing all the work tbh)',
      'One human. Many agents. Unlimited chaos.',
    ];
    this.showToast(secrets[index]);
  }

  private toggleSecretSection() {
    const section = this.container.querySelector('#secretSection');
    section?.classList.toggle('hidden');

    if (!section?.classList.contains('hidden')) {
      section?.scrollIntoView({ behavior: 'smooth' });
    }
  }

  private unlockSecretSection() {
    const section = this.container.querySelector('#secretSection');
    section?.classList.remove('hidden');
    section?.classList.add('unlocked');
    section?.scrollIntoView({ behavior: 'smooth' });
  }

  private activateMatrixMode() {
    if (this.easterEggActive) return;
    this.easterEggActive = true;

    const canvas = this.container.querySelector('#matrixCanvas') as HTMLCanvasElement;
    canvas?.classList.remove('hidden');

    this.showToast('🎮 Konami Code Activated! Welcome to the Matrix!');

    // Matrix rain effect
    if (canvas) {
      const ctx = canvas.getContext('2d')!;
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;

      const chars = 'TASKDOCK10アイウエオカキクケコサシスセソタチツテト'.split('');
      const columns = canvas.width / 20;
      const drops: number[] = [];

      for (let i = 0; i < columns; i++) {
        drops[i] = 1;
      }

      const draw = () => {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.05)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        ctx.fillStyle = '#0f0';
        ctx.font = '20px monospace';

        for (let i = 0; i < drops.length; i++) {
          const char = chars[Math.floor(Math.random() * chars.length)];
          ctx.fillText(char, i * 20, drops[i] * 20);

          if (drops[i] * 20 > canvas.height && Math.random() > 0.975) {
            drops[i] = 0;
          }
          drops[i]++;
        }
      };

      this.matrixInterval = window.setInterval(draw, 33);

      // Stop after 5 seconds
      setTimeout(() => {
        if (this.matrixInterval) {
          clearInterval(this.matrixInterval);
          this.matrixInterval = null;
        }
        canvas.classList.add('hidden');
        this.easterEggActive = false;
      }, 5000);
    }
  }

  private showToast(message: string) {
    const toast = document.createElement('div');
    toast.className = 'about-toast';
    toast.textContent = message;
    this.container.appendChild(toast);

    requestAnimationFrame(() => toast.classList.add('visible'));

    setTimeout(() => {
      toast.classList.remove('visible');
      setTimeout(() => toast.remove(), 300);
    }, 2500);
  }
}
