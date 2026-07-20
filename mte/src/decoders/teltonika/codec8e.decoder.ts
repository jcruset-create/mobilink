/**
 * Codec 8 Extended comparte estructura con Codec 8; la implementación
 * está unificada en Codec8Decoder (parámetro `extended`).
 * Este módulo existe para mantener la separación conceptual y permitir
 * divergencia futura sin romper imports.
 */
export { Codec8Decoder as Codec8ExtendedDecoder, CODEC_8E } from './codec8.decoder';
