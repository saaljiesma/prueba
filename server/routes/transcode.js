const express = require('express');
const router = express.Router();
const { spawn } = require('child_process');

/**
 * Stream VOD/LIVE optimizado para barra completa y seek funcional
 */
router.get('/', (req, res) => {
    const { url, type } = req.query;
    if (!url) return res.status(400).json({ error: 'URL parameter is required' });

    const ffmpegPath = req.app.locals.ffmpegPath || 'ffmpeg';

    // Detección inteligente VOD/LIVE
    const isVOD = type === 'vod' || url.includes('/movie/') || url.includes('/series/') || url.toLowerCase().endsWith('.mkv');

    // Movflags según tipo
    const movFlags = isVOD
        ? 'faststart+frag_keyframe+default_base_moof' // VOD → barra completa y seek funcional
        : 'frag_keyframe+empty_moov+default_base_moof'; // LIVE → baja latencia

    const bufSize = isVOD ? '100M' : '10M';

    // Headers para navegador
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Accept-Ranges', 'bytes'); // Crucial para que el navegador sepa que puede hacer seek

    // FFmpeg arguments
    const args = [
        '-hide_banner',
        '-loglevel', 'warning',
        '-reconnect', '1',
        '-reconnect_streamed', '1',
        '-reconnect_delay_max', '4',
        '-i', url,
        '-map', '0:v:0',
        '-map', '0:a:0?',
        '-c:v', 'copy', // CPU mínima
        '-c:a', 'aac',  // Audio universal
        '-ac', '2',
        '-b:a', '192k',
        '-af', 'aresample=async=1:min_hard_comp=0.100:first_pts=0',
        '-g', isVOD ? '48' : '250', // Keyframes frecuentes en VOD para seek rápido
        '-f', 'mp4',
        '-movflags', movFlags,
        '-bufsize', bufSize,
        '-max_muxing_queue_size', '4096',
        '-flush_packets', '1',
        '-'
    ];

    console.log(`[NodeCast] Modo: ${isVOD ? 'PELÍCULA (Seek habilitado)' : 'LIVE (Latencia baja)'}`);
    console.log(`[FFmpeg] Comando: ${ffmpegPath} ${args.join(' ')}`);

    const ffmpeg = spawn(ffmpegPath, args);

    // Tubería de salida al navegador
    ffmpeg.stdout.pipe(res);

    // Captura de errores
    ffmpeg.stderr.on('data', data => {
        const msg = data.toString();
        if (msg.toLowerCase().includes('error')) console.error('[FFmpeg Error]', msg);
    });

    // Limpieza total al cerrar la pestaña o el reproductor
    req.on('close', () => {
        console.log('[Stream] Cliente desconectado, cerrando FFmpeg');
        ffmpeg.kill('SIGKILL');
    });

    ffmpeg.on('exit', code => {
        if (code && code !== 255) console.log(`[Stream] FFmpeg salió con código ${code}`);
    });

    ffmpeg.on('error', err => {
        console.error('[Stream] FFmpeg spawn failed:', err);
        if (!res.headersSent) res.status(500).json({ error: 'Transcoding failed' });
    });
});

module.exports = router;
