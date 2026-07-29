document.addEventListener('DOMContentLoaded', () => {
    const root = document.documentElement;

    // Theme toggle (persisted in localStorage, defaults to system preference)
    const themeToggle = document.getElementById('themeToggle');
    if (themeToggle) {
        const storedTheme = localStorage.getItem('theme');
        if (storedTheme) {
            root.setAttribute('data-theme', storedTheme);
            themeToggle.setAttribute('aria-pressed', storedTheme === 'dark');
        }

        themeToggle.addEventListener('click', () => {
            const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
            const currentTheme = root.getAttribute('data-theme') || (prefersDark ? 'dark' : 'light');
            const nextTheme = currentTheme === 'dark' ? 'light' : 'dark';

            root.setAttribute('data-theme', nextTheme);
            localStorage.setItem('theme', nextTheme);
            themeToggle.setAttribute('aria-pressed', nextTheme === 'dark');
        });
    }

    // Mobile navigation toggle
    const navToggle = document.getElementById('navToggle');
    const navMenu = document.getElementById('navMenu');
    if (navToggle && navMenu) {
        navToggle.addEventListener('click', () => {
            const isOpen = navMenu.classList.toggle('open');
            navToggle.setAttribute('aria-expanded', isOpen);
        });

        navMenu.querySelectorAll('a').forEach(link => {
            link.addEventListener('click', () => {
                navMenu.classList.remove('open');
                navToggle.setAttribute('aria-expanded', 'false');
            });
        });
    }

    // Smooth scrolling for navigation links with sticky-nav offset
    document.querySelectorAll('nav a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            const targetId = this.getAttribute('href');
            const targetElement = document.querySelector(targetId);

            if (targetElement) {
                e.preventDefault();
                const nav = document.querySelector('nav');
                const navHeight = nav ? nav.offsetHeight : 0;
                const elementPosition = targetElement.getBoundingClientRect().top + window.pageYOffset;
                const offsetPosition = elementPosition - navHeight - 20; // breathing room

                window.scrollTo({
                    top: offsetPosition,
                    behavior: 'smooth'
                });
            }
        });
    });

    // Project filtering logic
    const filterButtons = document.querySelectorAll('.filter-btn');
    const projectCards = document.querySelectorAll('.project-card');

    filterButtons.forEach(button => {
        button.addEventListener('click', () => {
            filterButtons.forEach(btn => btn.classList.remove('active'));
            button.classList.add('active');

            const filter = button.dataset.filter;

            projectCards.forEach(card => {
                if (filter === 'all' || card.dataset.tech.includes(filter)) {
                    card.style.display = '';
                } else {
                    card.style.display = 'none';
                }
            });
        });
    });

    // Reveal sections on scroll
    const sections = document.querySelectorAll('main section');
    if ('IntersectionObserver' in window && sections.length) {
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    entry.target.classList.add('in-view');
                    observer.unobserve(entry.target);
                }
            });
        }, { threshold: 0.15 });

        sections.forEach(section => observer.observe(section));
    } else {
        sections.forEach(section => section.classList.add('in-view'));
    }
});
