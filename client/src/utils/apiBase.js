// URL base del backend — en producción se inyecta via VITE_API_URL en Vercel/Netlify.
// En desarrollo el proxy de Vite hace que '' (vacío) sea suficiente.
const API_BASE = import.meta.env.VITE_API_URL || '';
export default API_BASE;
