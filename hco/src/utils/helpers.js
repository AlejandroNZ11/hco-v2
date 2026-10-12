export function obtenerIniciales(nombre) {
  const partes = String(nombre || "").trim().split(/\s+/).filter(Boolean);
  if (!partes.length) return "US";
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
  return `${partes[0][0]}${partes[1][0]}`.toUpperCase();
}

export function convertirGoogleDriveUrl(url) {
  if (!url || typeof url !== "string") return "";
  const cleanUrl = url.trim();
  const matchFile = cleanUrl.match(/\/file\/d\/([^/]+)/);
  if (matchFile?.[1]) {
    return `https://drive.google.com/thumbnail?id=${matchFile[1]}&sz=w200`;
  }
  const matchId = cleanUrl.match(/[?&]id=([^&]+)/);
  if (matchId?.[1]) {
    return `https://drive.google.com/thumbnail?id=${matchId[1]}&sz=w200`;
  }
  return cleanUrl;
}

export function obtenerFuentesFoto(user) {
  return [
    user?.foto_url,
    user?.fotoDataUrl,
    user?.fotoWeb,
    user?.foto,
    user?.fotoUrl,
    user?.urlFoto,
    user?.imagen,
    user?.avatar,
    user?.photo,
    user?.picture,
  ]
    .map((v) => (typeof v === "string" ? convertirGoogleDriveUrl(v) : ""))
    .filter(Boolean);
}


// ========================================================
// 
// ========================================================
