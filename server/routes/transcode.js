const express = require('express');
const router = express.Router();
const { spawn } = require('child_process');

/**
 * Transcode stream optimizado para Raspberry Pi 4
 * Soporta TV en directo y Películas/Series (VOD)
 */
router.get('/', (req, res) => {
    const { url } = req.query;
    if (!url) {
        return res.status(400).json({ error: 'URL parameter is required' });
    }

    const ffmpegPath = req.app.locals.ffmpegPath || 'ffmpeg';

    // 1. DETECCIÓN DE CONTENIDO (Para aplicar carga "entera" en pelis)
    const isVOD = url.includes('movie') || 
                  url.includes('series') || 
                  url.toLowerCase().endsWith('.mkv') || 
                  url.toLowerCase().endsWith('.mp4');

    // 2. CONFIGURACIÓN DE FLAGS SEGÚN EL TIPO
    // faststart es clave para que el iPhone/Safari cargue la peli rápido
    let movFlags = isVOD 
        ? 'faststart+empty_moov+default_base_moof' 
        : 'frag_keyframe+empty_moov+default_base_moof';

    console.log(`[NodeCast] Reproduciendo: ${isVOD ? 'PELÍCULA/SERIE' : 'DIRECTO'}`);

    // 3. ARGUMENTOS OPTIMIZADOS (VLC Agent + Copy Video + AAC Audio)
    const args = [
        '-hide_banner',
        '-loglevel', 'warning',
        '-user_agent', 'VLC/3.0.20 (Linux; x86_64)', // Tu UA de confianza
        '-reconnect', '1',
        '-reconnect_streamed', '1',
        '-reconnect_delay_max', '4',
        '-i', url,
        '-map', '0:v:0',
        '-map', '0:a:0?',
        '-c:v', 'copy',      // RPi4: 0% CPU en video
        '-c:a', 'aac',       // Compatible con iOS/Safari
        '-ac', '2',          // Estéreo
        '-b:a', '128k',      // Calidad eficiente
        '-af', 'aresample=async=1:min_hard_comp=0.100000:first_pts=0',
        '-f', 'mp4',
        '-movflags', movFlags,
        '-flush_packets', '1',
        '-'
    ];

    let ffmpeg;
    try {
        ffmpeg = spawn(ffmpegPath, args);
    } catch (spawnErr) {
        console.error('[Transcode] Error al iniciar FFmpeg:', spawnErr);
        return res.status(500).json({ error: 'FFmpeg failed' });
    }

    // Headers para que el navegador lo reconozca como video MP4
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Access-Control-Allow-Origin', '*');
    // Header extra para saber qué modo se aplicó (puedes verlo en F12)
    res.setHeader('X-Stream-Type', isVOD ? 'VOD' : 'LIVE');

    // Tubería de datos: FFmpeg -> Navegador
    ffmpeg.stdout.pipe(res);

    // Logs de error para depurar
    ffmpeg.stderr.on('data', (data) => {
        if (data.toString().includes('Error')) {
            console.log(`[FFmpeg Error] ${data.toString()}`);
        }
    });

    // IMPORTANTE: Matar el proceso al cerrar la pestaña para no saturar la RPi4
    req.on('close', () => {
        console.log('[Transcode] Cliente desconectado. Liberando CPU...');
        ffmpeg.kill('SIGKILL');
    });

    ffmpeg.on('exit', (code) => {
        if (code !== null && code !== 0 && code !== 255) {
            console.error(`[Transcode] FFmpeg salió con código ${code}`);
        }
    });
});

module.exports = router;