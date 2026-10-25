export type InstallationFilm = {
  id: string;
  title: string;
  category: string;
  description: string;
  src: string;
  poster: string;
  duration: string;
  width: number;
  height: number;
};

// Curated excerpts of INOX 304 footage. Keep originals outside the public build.
export const installationFilms: readonly InstallationFilm[] = [
  {
    id: 'pruebas-encendido',
    title: 'Del montaje a la puesta en marcha',
    category: 'PRUEBAS DE FUNCIONAMIENTO',
    description: 'Un recorrido por las cocinas lineales instaladas, con sus hornillas encendidas y cada equipo en funcionamiento.',
    src: '/media/installations/pruebas-encendido.mp4',
    poster: '/media/installations/pruebas-encendido.webp',
    duration: '0:12', width: 1280, height: 720,
  },
  {
    id: 'cocina-instalada',
    title: 'Una cocina, de principio a fin',
    category: 'EQUIPAMIENTO INSTALADO',
    description: 'Cocinas, campanas, estantes y lavaderos en un mismo espacio. Una vista de la distribución y los acabados del proyecto terminado.',
    src: '/media/installations/cocina-instalada.mp4',
    poster: '/media/installations/cocina-instalada.webp',
    duration: '0:15', width: 608, height: 1080,
  },
  {
    id: 'extraccion-ducteria',
    title: 'La instalación también cuenta',
    category: 'CAMPANAS Y DUCTERÍA',
    description: 'El recorrido de los ductos por el espacio y su conexión con la campana de la cocina, vistos desde el lugar de instalación.',
    src: '/media/installations/extraccion-ducteria.mp4',
    poster: '/media/installations/extraccion-ducteria.webp',
    duration: '0:24', width: 608, height: 1080,
  },
  {
    id: 'fabricacion-taller',
    title: 'El detalle empieza en el taller',
    category: 'FABRICACIÓN EN ACERO',
    description: 'Un acercamiento a la soldadura de una pieza de acero inoxidable durante su fabricación en el taller.',
    src: '/media/installations/fabricacion-taller.mp4',
    poster: '/media/installations/fabricacion-taller.webp',
    duration: '0:18', width: 608, height: 1080,
  },
];
