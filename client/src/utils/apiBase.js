// En desarrollo el proxy de Vite redirige /api → localhost:4000, por eso '' funciona.
// En producción DEBE estar definida VITE_API_URL antes del build (variable de entorno en Render).
const API_BASE = import.meta.env.VITE_API_URL || '';

if (!API_BASE && import.meta.env.PROD) {
  console.error('[AgendIA] VITE_API_URL no está definida. Las peticiones al backend fallarán.');
}

export default API_BASE;
