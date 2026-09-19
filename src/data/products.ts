// Product information transcribed from the owner-supplied catalog PDFs.
// Prices and unspecified warranty terms are intentionally excluded.

import type { ProductCategory } from './categories.ts';
export { categories, type ProductCategory } from './categories.ts';

export type Product = {
  id: string;
  slug: string;
  name: string;
  category: ProductCategory;
  summary: string;
  features: string[];
  image: string;
  featured: boolean;
  contactId?: string;
  price?: number;
  currency?: 'PEN' | 'USD';
  showPrice?: boolean;
  technicalSheet?: string;
  model3d?: string;
  modelPoster?: string;
  gallery?: string[];
};

export const products: Product[] = [
  {
    "id": "P01",
    "slug": "cocina-semiindustrial-4-hornillas-horno-electrico",
    "name": "Cocina semiindustrial 4 hornillas + horno eléctrico",
    "category": "linea-caliente",
    "summary": "Cocina de cuatro hornillas con horno eléctrico y rostizador para el hogar o el negocio.",
    "features": [
      "4 parrillas de fierro fundido",
      "Quemadores de 4\" de fierro fundido",
      "Horno eléctrico con rostizador incorporado",
      "Función gratinado",
      "Estructura resistente y excelente acabado"
    ],
    "image": "/images/products/cocina-semiindustrial-4-hornillas-horno-electrico.webp",
    "featured": false
  },
  {
    "id": "P02",
    "slug": "cocina-industrial-de-3-hornillas",
    "name": "Cocina industrial de 3 hornillas",
    "category": "linea-caliente",
    "summary": "Tres hornillas con controles independientes, estructura reforzada y repisa inferior para cocinas profesionales.",
    "features": [
      "3 hornillas de alta potencia con controles independientes",
      "Acero inoxidable AISI 304",
      "Estructura reforzada en tubo rectangular de 6\" x 2\"",
      "Parrillas de fierro fundido importado",
      "Repisa inferior",
      "Patas antideslizantes; fabricación a medida"
    ],
    "image": "/images/products/cocina-industrial-de-3-hornillas.jpg",
    "featured": true
  },
  {
    "id": "P03",
    "slug": "cocina-industrial-de-3-parrillas",
    "name": "Cocina industrial de 3 parrillas (CÓD-CIF-03)",
    "category": "linea-caliente",
    "summary": "Cocina de tres quemadores con superficie amplia de cocción y repisa inferior.",
    "features": [
      "Acero inoxidable",
      "3 quemadores de alta potencia",
      "Repisa inferior",
      "Ideal para restaurantes, cafeterías y cocinas profesionales"
    ],
    "image": "/images/products/cocina-industrial-de-3-parrillas.webp",
    "featured": false
  },
  {
    "id": "P04",
    "slug": "cocina-industrial-4-hornillas-tipo-isla-plancha-ho",
    "name": "Cocina industrial 4 hornillas tipo isla + plancha + horno (CIH-4P)",
    "category": "linea-caliente",
    "summary": "Cuatro hornillas, plancha y horno integrados en una cocina de diseño tipo isla.",
    "features": [
      "4 hornillas de alta potencia",
      "Plancha incorporada",
      "Horno para cocinar a la par distintos platillos",
      "Diseño tipo isla en acero inoxidable"
    ],
    "image": "/images/products/cocina-industrial-4-hornillas-tipo-isla-plancha-ho.webp",
    "featured": true
  },
  {
    "id": "P05",
    "slug": "cocina-industrial-tipo-isla-4-parrillas-plancha-ho",
    "name": "Cocina industrial tipo isla 4 parrillas + plancha + horno (CÓD-CHI-04)",
    "category": "linea-caliente",
    "summary": "Equipo tipo isla con cuatro parrillas, plancha y horno para diferentes preparaciones.",
    "features": [
      "4 parrillas clásicas",
      "1 plancha",
      "Horno incorporado",
      "Acero inoxidable"
    ],
    "image": "/images/products/cocina-industrial-tipo-isla-4-parrillas-plancha-ho.webp",
    "featured": false
  },
  {
    "id": "P06",
    "slug": "horno-multiuso",
    "name": "Horno multiuso (HI-MU)",
    "category": "linea-caliente",
    "summary": "Horno de uso comercial para panadería, pastelería y otras preparaciones.",
    "features": [
      "Cocción uniforme",
      "Funcionamiento continuo por horas",
      "Uso comercial / pastelería / panadería"
    ],
    "image": "/images/products/horno-multiuso.webp",
    "featured": false
  },
  {
    "id": "P07",
    "slug": "horno-ecologico-para-pollo-a-la-brasa",
    "name": "Horno ecológico para pollo a la brasa",
    "category": "linea-caliente",
    "summary": "Horno para pollo a la brasa construido en acero inoxidable AISI 304.",
    "features": [
      "Bajo mantenimiento y fácil limpieza",
      "Menos humo y menor consumo de carbón",
      "Construcción resistente y duradera en AISI 304"
    ],
    "image": "/images/products/horno-ecologico-para-pollo-a-la-brasa.webp",
    "featured": false
  },
  {
    "id": "P08",
    "slug": "horno-pollero-ecologico",
    "name": "Horno pollero ecológico (CÓD-HPE-1)",
    "category": "linea-caliente",
    "summary": "Horno pollero con interior de ladrillos refractarios y estructura de acero inoxidable.",
    "features": [
      "Ladrillos refractarios interiores",
      "Acero inoxidable",
      "Diseño ecológico"
    ],
    "image": "/images/products/horno-pollero-ecologico.webp",
    "featured": false
  },
  {
    "id": "P09",
    "slug": "parrilla-premium-plancha-y-parrilla-a-carbon",
    "name": "Parrilla premium / Plancha y parrilla a carbón",
    "category": "linea-caliente",
    "summary": "Parrilla con elevación del carbón y encendido a gas, disponible en medidas personalizadas.",
    "features": [
      "Acero inoxidable 304",
      "Sistema de elevación del carbón",
      "Encendido a gas; 02 quemadores",
      "Ladrillos refractarios",
      "Medidas personalizadas; producto 100% peruano",
      "Envíos a todo el país"
    ],
    "image": "/images/products/parrilla-premium-plancha-y-parrilla-a-carbon.webp",
    "featured": true
  },
  {
    "id": "P10",
    "slug": "parrilla-grande",
    "name": "Parrilla grande (CÓD-PGI-1)",
    "category": "linea-caliente",
    "summary": "Parrilla con sistema de elevación, ladrillos refractarios y ruedas para traslado.",
    "features": [
      "Sistema de elevación",
      "Ladrillos refractarios",
      "Acero inoxidable",
      "Ruedas para traslado"
    ],
    "image": "/images/products/parrilla-grande.webp",
    "featured": false
  },
  {
    "id": "P11",
    "slug": "caja-china-grande",
    "name": "Caja china grande (CÓD-CC-1T1V)",
    "category": "linea-caliente",
    "summary": "Caja china de acero inoxidable con tapa ahumadora y puerta con visor de vidrio.",
    "features": [
      "Tapa ahumadora",
      "Puerta con visor de vidrio",
      "Acero inoxidable"
    ],
    "image": "/images/products/caja-china-grande.webp",
    "featured": false
  },
  {
    "id": "P12",
    "slug": "freidora-doble-profesional",
    "name": "Freidora doble profesional",
    "category": "linea-caliente",
    "summary": "Freidora de doble poza con controles independientes, gabinete inferior y ruedas industriales.",
    "features": [
      "Acero inoxidable AISI 304",
      "Doble poza, 2 canastillas",
      "Control independiente de temperatura",
      "Gabinete inferior de almacenamiento",
      "Ruedas industriales",
      "Ideal para pollerías, fast food, restaurantes y hoteles"
    ],
    "image": "/images/products/freidora-doble-profesional.jpg",
    "featured": true
  },
  {
    "id": "P13",
    "slug": "freidora-de-papa-profesional",
    "name": "Freidora de papa profesional (2 canastillas)",
    "category": "linea-caliente",
    "summary": "Freidora de dos canastillas con control de temperatura y formato compacto con ruedas.",
    "features": [
      "Acero inoxidable AISI 304",
      "2 canastillas con mangos de fácil agarre",
      "Control preciso de temperatura",
      "Alta capacidad de fritura, diseño compacto",
      "Equipada con ruedas"
    ],
    "image": "/images/products/freidora-de-papa-profesional.jpg",
    "featured": false
  },
  {
    "id": "P14",
    "slug": "freidora-automatica-de-papas",
    "name": "Freidora automática de papas",
    "category": "linea-caliente",
    "summary": "Freidora automática en acero inoxidable para negocios de alta producción.",
    "features": [
      "Acero inoxidable Inox 304",
      "Funcionamiento automático",
      "Alta producción",
      "Ahorro de gas",
      "Fácil limpieza y mantenimiento"
    ],
    "image": "/images/products/freidora-automatica-de-papas.jpg",
    "featured": false
  },
  {
    "id": "P15",
    "slug": "modulo-de-comida-4-en-1",
    "name": "Módulo de comida 4 en 1 (carrito salchipapero)",
    "category": "linea-caliente",
    "summary": "Broastera, freidora, conservadora y plancha integradas en un módulo para comida rápida.",
    "features": [
      "Broastera de pollo",
      "Freidora de papas",
      "Conservadora de alimentos",
      "Plancha para hamburguesas",
      "Mayor potencia de calor"
    ],
    "image": "/images/products/modulo-de-comida-4-en-1.jpg",
    "featured": false
  },
  {
    "id": "P16",
    "slug": "armario-refrigerado-de-2-puertas",
    "name": "Armario refrigerado de 2 puertas",
    "category": "linea-fria",
    "summary": "Armario de dos puertas con control digital de temperatura y niveles regulables.",
    "features": [
      "Acero inoxidable AISI 304",
      "2 puertas / gran capacidad",
      "Control digital de temperatura",
      "Parrillas y niveles regulables",
      "Diseño higiénico, fácil de limpiar"
    ],
    "image": "/images/products/armario-refrigerado-de-2-puertas.webp",
    "featured": true
  },
  {
    "id": "P17",
    "slug": "armarios-frigorificos-camara-frigorifica",
    "name": "Armarios frigoríficos / Cámara frigorífica",
    "category": "linea-fria",
    "summary": "Armarios de acero inoxidable AISI 304 para congelación y conservación, en diferentes capacidades.",
    "features": [
      "Uso profesional",
      "Diferentes capacidades y modelos",
      "Envíos a nivel nacional"
    ],
    "image": "/images/products/armarios-frigorificos-camara-frigorifica.webp",
    "featured": false
  },
  {
    "id": "P18",
    "slug": "mesa-fria",
    "name": "Mesa fría",
    "category": "linea-fria",
    "summary": "Mesa refrigerada de acero inoxidable 304 para conservar o congelar alimentos.",
    "features": [
      "Eficiencia energética",
      "Diseño compacto y funcional",
      "Conserva o congela alimentos",
      "Íntegramente en acero inoxidable 304"
    ],
    "image": "/images/products/mesa-fria.webp",
    "featured": false
  },
  {
    "id": "P19",
    "slug": "visicooler-580-litros",
    "name": "Visicooler 580 litros",
    "category": "linea-fria",
    "summary": "Visicooler para bebidas con capacidad de 580 litros y sistema fan cooling.",
    "features": [
      "Capacidad 580 L",
      "Fan cooling"
    ],
    "image": "/images/products/visicooler-580-litros.webp",
    "featured": false
  },
  {
    "id": "P20",
    "slug": "vitrina-refrigerada",
    "name": "Vitrina refrigerada (CÓD-VRC-1)",
    "category": "linea-fria",
    "summary": "Vitrina para almacenar y exhibir carnes, embutidos y lácteos con refrigeración.",
    "features": [
      "Exhibición refrigerada",
      "Ideal para carnes, embutidos y lácteos"
    ],
    "image": "/images/products/vitrina-refrigerada.webp",
    "featured": false
  },
  {
    "id": "P21",
    "slug": "abatidor-de-temperatura-de-5-bandejas",
    "name": "Abatidor de temperatura de 5 bandejas",
    "category": "linea-fria",
    "summary": "Equipo de cinco bandejas para enfriar o congelar alimentos rápidamente.",
    "features": [
      "5 bandejas",
      "Acero inoxidable"
    ],
    "image": "/images/products/abatidor-de-temperatura-de-5-bandejas.webp",
    "featured": false
  },
  {
    "id": "P22",
    "slug": "exhibidor-refrigerado-abierto",
    "name": "Exhibidor refrigerado abierto",
    "category": "linea-fria",
    "summary": "Exhibidor abierto de 116 cm de ancho con cuatro repisas para bebidas.",
    "features": [
      "116 cm de ancho",
      "4 repisas",
      "Tipo open cooler"
    ],
    "image": "/images/products/exhibidor-refrigerado-abierto.webp",
    "featured": false
  },
  {
    "id": "P23",
    "slug": "lavatorio-con-repisas-superiores",
    "name": "Lavatorio con repisas superiores",
    "category": "linea-neutra",
    "summary": "Lavatorio con almacenamiento superior, fabricado según los requerimientos del espacio.",
    "features": [
      "Diseño funcional",
      "Alta resistencia",
      "Fácil limpieza e higiene",
      "Acabado profesional",
      "Fabricación según requerimiento"
    ],
    "image": "/images/products/lavatorio-con-repisas-superiores.webp",
    "featured": false
  },
  {
    "id": "P24",
    "slug": "lavatorio-de-1-poza",
    "name": "Lavatorio de 1 poza",
    "category": "linea-neutra",
    "summary": "Lavatorio de una poza profunda con escurridor derecho, respaldo y repisa inferior.",
    "features": [
      "Acero inoxidable AISI 304",
      "1 poza profunda 50 x 50 x 32 cm",
      "Escurridor al lado derecho",
      "Respaldo contra salpicaduras",
      "Repisa inferior"
    ],
    "image": "/images/products/lavatorio-de-1-poza.webp",
    "featured": true
  },
  {
    "id": "P25",
    "slug": "lavatorio-de-2-pozas-escurridores",
    "name": "Lavatorio de 2 pozas + escurridores (L2P-EVPC)",
    "category": "linea-neutra",
    "summary": "Lavatorio de dos pozas con escurridores para vasos, platos y cubiertos.",
    "features": [
      "2 pozas",
      "Escurridor de vasos",
      "Escurridor de platos y cucharas",
      "Acero inoxidable 304"
    ],
    "image": "/images/products/lavatorio-de-2-pozas-escurridores.webp",
    "featured": false
  },
  {
    "id": "P26",
    "slug": "lavadero-de-2-pozas-con-descanso",
    "name": "Lavadero de 2 pozas con descanso (CÓD-LVD-2)",
    "category": "linea-neutra",
    "summary": "Lavadero de dos pozas con un descanso y división, fabricado en acero inoxidable.",
    "features": [
      "2 pozas",
      "1 descanso",
      "División",
      "Acero inoxidable"
    ],
    "image": "/images/products/lavadero-de-2-pozas-con-descanso.webp",
    "featured": false
  },
  {
    "id": "P27",
    "slug": "estante-de-5-niveles",
    "name": "Estante de 5 niveles",
    "category": "mobiliario",
    "summary": "Estante de cinco niveles en acero inoxidable AISI 304, con fabricación a medida.",
    "features": [
      "Acero inoxidable AISI 304",
      "5 niveles de almacenamiento",
      "Estructura de 1.2 mm de espesor",
      "Fabricación a medida"
    ],
    "image": "/images/products/estante-de-5-niveles.jpg",
    "featured": true
  },
  {
    "id": "P28",
    "slug": "mesa-central-de-trabajo",
    "name": "Mesa central de trabajo (CÓD-MT-1D)",
    "category": "mobiliario",
    "summary": "Mesa central de acero inoxidable con una división inferior para organizar el trabajo.",
    "features": [
      "1 división inferior",
      "100% acero inoxidable"
    ],
    "image": "/images/products/mesa-central-de-trabajo.jpg",
    "featured": false
  },
  {
    "id": "P29",
    "slug": "estacion-bartender-profesional",
    "name": "Estación bartender profesional",
    "category": "mobiliario",
    "summary": "Estación de acero inoxidable para bares, restaurantes y hoteles, con fabricación a medida.",
    "features": [
      "Acero inoxidable AISI 304",
      "Área para hielo, botellas e insumos",
      "Compartimientos de almacenamiento",
      "Fabricación a medida"
    ],
    "image": "/images/products/estacion-bartender-profesional.jpg",
    "featured": false
  },
  {
    "id": "P30",
    "slug": "licuadora-industrial",
    "name": "Licuadora industrial",
    "category": "linea-neutra",
    "summary": "Licuadora industrial de acero inoxidable AISI 304 disponible en cuatro capacidades.",
    "features": [
      "Acero inoxidable AISI 304",
      "Capacidades: 10, 15, 20 y 25 litros",
      "Estructura robusta de uso industrial",
      "Fácil limpieza y mantenimiento"
    ],
    "image": "/images/products/licuadora-industrial.jpg",
    "featured": true
  },
  {
    "id": "P31",
    "slug": "licuadora-industrial-con-base",
    "name": "Licuadora industrial (modelo con base)",
    "category": "linea-neutra",
    "summary": "Licuadora industrial con base de acero inoxidable 304 disponible en tres capacidades.",
    "features": [
      "Capacidades: 10, 15 y 20 L",
      "Ideal para juguerías, restaurantes y panaderías"
    ],
    "image": "/images/products/licuadora-industrial-con-base.jpg",
    "featured": false
  },
  {
    "id": "P32",
    "slug": "maquina-cremoladera-25-l",
    "name": "Máquina cremoladera 25 L",
    "category": "linea-fria",
    "summary": "Máquina para cremoladas de 25 litros con dos tolvas.",
    "features": [
      "25 litros",
      "2 tolvas"
    ],
    "image": "/images/products/maquina-cremoladera-25-l.jpg",
    "featured": false
  }
];
