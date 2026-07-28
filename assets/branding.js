// ============================================================
// BRANDING DEL CLIENTE — el nombre del negocio (los colores están en
// branding.css y el logo es logo.svg). Prefija el título de cada pestaña
// y completa el alt del logo.
// ============================================================
window.BRAND = { nombre: 'Evolutio' };

document.title = BRAND.nombre + ' · ' + document.title;
document.addEventListener('DOMContentLoaded', function () {
  document.querySelectorAll('.logo-card img, .brand img').forEach(function (img) {
    img.alt = BRAND.nombre;
  });
});
