const express = require('express');
const router = express.Router();
const { spawn } = require('child_process');

/**
 * Transcode stream optimizado para Raspberry Pi 4
 * Especial para películas MKV y visualización en iOS/Safari
 */
router.get('/', (req, res) => {
    const { url } = req.query;
    if (!url) {
        return res.status(400).json({ error: 'URL parameter is required' });
    }

    const ffmpegPath = req.app.locals.ffmpegPath || 'ffmpeg';

    // 1. DETECCIÓN INTELIGENTE DE PELÍCULA (VOD)
    // Buscamos patrones en la URL para saber si es un archivo estático o TV en vivo
    const isVOD = url.includes('/movie/') || 
                  url.includes('/series/') || 
                  url.toLowerCase().endsWith('.mkv') || 
                  url.toLowerCase().endsWith('.mp4');

    // 2. CONFIGURACIÓN DE FLAGS SEGÚN EL TIPO
    // Para Películas: Usamos 'faststart' para que Safari permita adelantar/saltar.
    // Para Directos: Usamos fragmentación para minimizar la latencia.
    let movFlags = isVOD 
        ? 'faststart+empty_moov+omit_tfhd_offset+frag_keyframe+default_base_moof' 
        : 'frag_keyframe+empty_moov+default_base_moof';

    console.log(`[NodeCast] Iniciando: ${isVOD ? 'PELÍCULA (Modo Búsqueda Rápida)' : 'CANAL EN DIRECTO'}`);

    // 3. ARGUMENTOS FFMPEG (Optimización RPi4 + Llenado de Barra de Progreso)
    const args = [
        '-hide_banner',
        '-loglevel', 'warning',
        '-user_agent', 'VLC/3.0.20 (Linux; x86_64)', // User Agent compatible
        '-reconnect', '1',
        '-reconnect_streamed', '1',
        '-reconnect_delay_max', '4',
        
        // Entrada
        '-i', url,

        // Mapeo: Solo primer video y primer audio (evita errores con pistas de subs)
        '-map', '0:v:0',
        '-map', '0:a:0?',

        // Codecs: Copy para video (0% CPU) y AAC para audio (necesario para iOS)
        '-c:v', 'copy',
        '-c:a', 'aac',
        '-ac', '2',
        '-b:a', '192k', // Audio de alta calidad
        
        // Filtro para mantener sincronía A/V si hay lag en el MKV
        '-af', 'aresample=async=1:min_hard_comp=0.100000:first_pts=0',
        
        // Formato y Buffer agresivo
        '-f', 'mp4',
        '-movflags', movFlags,
        '-max_muxing_queue_size', '4096',
        '-bufsize', isVOD ? '100M' : '10M', // Buffer grande para llenar la barra en pelis
        '-flush_packets', '1',
        '-'
    ];

    // Log del comando para que lo veas en tu Log Viewer
    console.log('[FFmpeg Full Command]', `${ffmpegPath} ${args.join(' ')}`);

    let ffmpeg;
    try {
        ffmpeg = spawn(ffmpegPath, args);
    } catch (spawnErr) {
        console.error('[Transcode] Error fatal al iniciar FFmpeg:', spawnErr);
        return res.status(500).json({ error: 'FFmpeg failed' });
    }

    // Headers para el navegador
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('X-Content-Type-Options', 'nosniff'); // Ayuda a Safari a no dudar del formato

    // Tubería de datos: FFmpeg -> Navegador
    ffmpeg.stdout.pipe(res);

    // Captura de errores de FFmpeg
    ffmpeg.stderr.on('data', (data) => {
        const msg = data.toString();
        if (msg.includes('Error')) {
            console.log(`[FFmpeg Error Detail] ${msg}`);
        }
    });

    // Limpieza al cerrar la pestaña: MUY IMPORTANTE en Raspberry Pi
    req.on('close', () => {
        console.log('[Transcode] Reproducción detenida. Matando proceso FFmpeg...');
        ffmpeg.kill('SIGKILL');
    });

    ffmpeg.on('exit', (code) => {
        if (code !== null && code !== 0 && code !== 255) {
            console.error(`[Transcode] FFmpeg terminó con error: ${code}`);
        }
    });
});

module.exports = router;