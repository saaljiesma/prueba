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
    let movFlags = isVOD 
        ? 'faststart+empty_moov+default_base_moof' 
        : 'frag_keyframe+empty_moov+default_base_moof';

    console.log(`[NodeCast] Reproduciendo: ${isVOD ? 'PELÍCULA/SERIE' : 'DIRECTO'}`);

    // 3. ARGUMENTOS OPTIMIZADOS (VLC Agent + Copy Video + AAC Audio)
    const args = [
        '-hide_banner',
        '-loglevel', 'debug',    // 🔹 debug para ver todo en stderr
        '-report',               // 🔹 genera archivo ffmpeg-*.log
        '-user_agent', 'VLC/3.0.20 (Linux; x86_64)',
        '-reconnect', '1',
        '-reconnect_streamed', '1',
        '-reconnect_delay_max', '4',
        '-i', url,
        '-map', '0:v:0',
        '-map', '0:a:0?',
        '-c:v', 'copy',
        '-c:a', 'aac',
        '-ac', '2',
        '-b:a', '128k',
        '-af', 'aresample=async=1:min_hard_comp=0.100000:first_pts=0',
        '-f', 'mp4',
        '-movflags', movFlags,
        '-flush_packets', '1',
        '-'
    ];

    // ✅ Mostrar en consola los argumentos que se van a usar
    console.log('[FFmpeg Args]', args.join(' '));

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
    res.setHeader('X-Stream-Type', isVOD ? 'VOD' : 'LIVE');

    // 🔹 Header opcional con resumen seguro de argumentos (sin URL completa)
    const safeArgs = args.map(arg => arg === url ? '[URL]' : arg).join(' ');
    res.setHeader('X-FFmpeg-Args', safeArgs);

    // Tubería de datos: FFmpeg -> Navegador
    ffmpeg.stdout.pipe(res);

    // Logs de FFmpeg en tiempo real
    ffmpeg.stderr.on('data', (data) => {
        console.log(`[FFmpeg Output] ${data.toString()}`);
    });

    // IMPORTANTE: Matar el proceso al cerrar la pestaña para no saturar la RPi4
    req.on('close', () => {
        console.log('[Transcode] Cliente desconectado. Liberando CPU...');
        ffmpeg.kill('SIGKILL');
    });

    ffmpeg.on('exit', (code) => {
        if (code !== null && code !== 0 && code !== 255) {
            console.error(`[Transcode] FFmpeg salió con código ${code}`);
        } else {
            console.log('[Transcode] FFmpeg finalizó correctamente.');
        }
    });
});

module.exports = router;
