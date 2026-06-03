/**
 * v3.26: 이미지 생성은 Google Imagen 4 전용.
 * 기존 import 경로 호환을 위해 google/imagen 재export.
 */
export {
  generateImage,
  selectImagenModel as selectImageModel,
  selectImageModelForWorkspace,
  type ImagenModel as ImageModel,
} from '../google/imagen.js';
