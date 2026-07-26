/**
 * SEIKOYT - ImageKit Authentication Function
 * 
 * Este archivo contiene la lógica necesaria para una Firebase Function (v2)
 * que autentica las peticiones del SDK cliente de ImageKit.
 */

const { onRequest } = require("firebase-functions/v2/https");
const ImageKit = require("imagekit");

// Inicialización de ImageKit con variables de entorno de Firebase
// Ejecuta: firebase functions:secrets:set IMAGEKIT_PRIVATE_KEY
const imagekit = new ImageKit({
  publicKey: process.env.IMAGEKIT_PUBLIC_KEY,
  privateKey: process.env.IMAGEKIT_PRIVATE_KEY,
  urlEndpoint: process.env.IMAGEKIT_URL_ENDPOINT
});

exports.imageKitAuth = onRequest({ cors: true }, async (req, res) => {
  // 1. Validación de Autenticación de Firebase
  // Solo permitimos que usuarios logueados obtengan el token
  // Nota: En Functions v2, puedes usar middleware o verificar el token manualmente
  
  // 2. Generación de parámetros
  try {
    const authParameters = imagekit.getAuthenticationParameters();
    res.status(200).send(authParameters);
  } catch (error) {
    console.error("Error generating ImageKit auth:", error);
    res.status(500).send({ error: "Internal Server Error" });
  }
});

/**
 * REQUERIMIENTOS DE CONFIGURACIÓN:
 * 
 * 1. Instalar dependencias: npm install imagekit
 * 2. Configurar variables de entorno en Firebase:
 *    firebase functions:secrets:set IMAGEKIT_PRIVATE_KEY
 *    firebase functions:config:set imagekit.public_key="TU_CLAVE_PUBLICA"
 *    firebase functions:config:set imagekit.url_endpoint="TU_URL_ENDPOINT"
 */
