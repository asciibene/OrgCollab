    tailwind.config = {
      darkMode: 'class',
      theme: {
        extend: {
          fontFamily: {
            sans: ['Inter', 'system-ui', 'sans-serif'],
            mono: ['JetBrains Mono', 'monospace'],
          },
          colors: {
            bg: '#0d1117',
            surface: '#161b22',
            surfaceHover: '#1f242c',
            border: '#262c36',
            textMain: '#e6edf3',
            textMuted: '#8b949e',
            accent: '#58a6ff',
            todo: '#f85149',
            done: '#3fb950',
            tag: '#d2a8ff',
          }
        }
      }
    };

    window.orgCollabAppReady = false;
    window.addEventListener('load', () => {
      if (!window.orgCollabAppReady) {
        const error = document.getElementById('gate-error');
        error.textContent = 'The app could not start. Check your connection and reload; if it continues, check the browser console for a JavaScript module error.';
        error.classList.remove('hidden');
      }
    }, { once: true });
