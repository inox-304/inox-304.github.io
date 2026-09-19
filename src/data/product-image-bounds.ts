export type ProductImageBounds = {
  width: number;
  height: number;
  bounds: { x: number; y: number; width: number; height: number };
};

// Visible bounds measured at alpha >= 16. Faint edge shadows are excluded.
export const productImageBounds: Record<string, ProductImageBounds> = {
  '/images/products/cocina-semiindustrial-4-hornillas-horno-electrico.webp': { width: 1203, height: 1307, bounds: { x: 0, y: 39, width: 1167, height: 1261 } },
  '/images/products/cocina-industrial-de-3-parrillas.webp': { width: 1400, height: 1025, bounds: { x: 0, y: 20, width: 1400, height: 977 } },
  '/images/products/cocina-industrial-4-hornillas-tipo-isla-plancha-ho.webp': { width: 1400, height: 840, bounds: { x: 23, y: 18, width: 1290, height: 766 } },
  '/images/products/cocina-industrial-tipo-isla-4-parrillas-plancha-ho.webp': { width: 1400, height: 941, bounds: { x: 19, y: 0, width: 1381, height: 885 } },
  '/images/products/horno-multiuso.webp': { width: 980, height: 1605, bounds: { x: 64, y: 17, width: 880, height: 1553 } },
  '/images/products/horno-ecologico-para-pollo-a-la-brasa.webp': { width: 1203, height: 1307, bounds: { x: 190, y: 0, width: 995, height: 1298 } },
  '/images/products/horno-pollero-ecologico.webp': { width: 1059, height: 1485, bounds: { x: 24, y: 19, width: 1017, height: 1447 } },
  '/images/products/parrilla-premium-plancha-y-parrilla-a-carbon.webp': { width: 1239, height: 1269, bounds: { x: 30, y: 49, width: 1209, height: 1191 } },
  '/images/products/parrilla-grande.webp': { width: 1335, height: 1178, bounds: { x: 39, y: 33, width: 1296, height: 1138 } },
  '/images/products/caja-china-grande.webp': { width: 1324, height: 1188, bounds: { x: 15, y: 24, width: 1309, height: 1164 } },
  '/images/products/armario-refrigerado-de-2-puertas.webp': { width: 1107, height: 1421, bounds: { x: 54, y: 29, width: 1050, height: 1285 } },
  '/images/products/armarios-frigorificos-camara-frigorifica.webp': { width: 1168, height: 1347, bounds: { x: 61, y: 16, width: 1098, height: 1317 } },
  '/images/products/mesa-fria.webp': { width: 1254, height: 1254, bounds: { x: 118, y: 11, width: 1136, height: 1243 } },
  '/images/products/visicooler-580-litros.webp': { width: 887, height: 1774, bounds: { x: 96, y: 9, width: 699, height: 1733 } },
  '/images/products/vitrina-refrigerada.webp': { width: 1400, height: 955, bounds: { x: 23, y: 8, width: 1377, height: 944 } },
  '/images/products/abatidor-de-temperatura-de-5-bandejas.webp': { width: 1141, height: 1378, bounds: { x: 34, y: 52, width: 1097, height: 1290 } },
  '/images/products/exhibidor-refrigerado-abierto.webp': { width: 1050, height: 1498, bounds: { x: 74, y: 18, width: 935, height: 1463 } },
  '/images/products/lavatorio-con-repisas-superiores.webp': { width: 1020, height: 1541, bounds: { x: 10, y: 33, width: 1010, height: 1508 } },
  '/images/products/lavatorio-de-1-poza.webp': { width: 1400, height: 991, bounds: { x: 86, y: 0, width: 1304, height: 941 } },
  '/images/products/lavatorio-de-2-pozas-escurridores.webp': { width: 1400, height: 1107, bounds: { x: 61, y: 9, width: 1276, height: 1093 } },
  '/images/products/lavadero-de-2-pozas-con-descanso.webp': { width: 1400, height: 775, bounds: { x: 44, y: 0, width: 1356, height: 768 } },
};
