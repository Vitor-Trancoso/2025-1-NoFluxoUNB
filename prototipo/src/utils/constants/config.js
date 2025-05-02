const CONFIG = {
    ROUTES: {
        HOME: '/src/pages/home/index.html',
        LOGIN: '/src/pages/login/index.html',
        CADASTRO: '/src/pages/cadastro/index.html',
        FLUXOGRAMAS: '/src/pages/fluxogramas/index.html',
        ASSISTENTE: '/src/pages/assistente/index.html'
    },
    API: {
        BASE_URL: 'http://localhost:3000',
        ENDPOINTS: {
            LOGIN: '/api/auth/login',
            REGISTER: '/api/auth/register',
            COURSES: '/api/courses',
            EQUIVALENCES: '/api/equivalences'
        }
    },
    STORAGE: {
        USER_KEY: 'nofluxo_user',
        TOKEN_KEY: 'nofluxo_token'
    },
    THEME: {
        COLORS: {
            PRIMARY: '#4F46E5',
            SECONDARY: '#7C3AED',
            BACKGROUND: '#0F172A',
            TEXT: '#F8FAFC',
            GRAY: '#64748B'
        },
        FONTS: {
            PRIMARY: 'Graffiti',
            SECONDARY: 'Arial, sans-serif'
        }
    }
};

export default CONFIG; 