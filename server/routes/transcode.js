const express = require('express');
const router = express.Router();
const { spawn } = require('child_process');

/**
 * Stream VOD/LIVE optimizado para duración completa y seek funcional
 * GET /stream?url=...&type=vod|live
 */
router.get('/', (req, res) => {
    const { url, type } = req.query;
    if (!url) return res.status(400).json({ error: 'URL parameter is required' });

    const ffmpegPath = req.app.locals.ffmpegPath || 'ffmpeg';
    const isVOD = type === 'vod';

    // Movflags y bufsize según tipo
    const movFlags = isVOD
        ? 'faststart+frag_keyframe+default_base_moof' // VOD → duración completa y seek
        : 'frag_keyframe+empty_moov+default_base_moof'; // LIVE → baja latencia
    const bufSize = isVOD ? '100M' : '10M';

    // Headers para navegador
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Accept-Ranges', 'bytes'); // Crucial para seek

    // FFmpeg args
    const args = [
        '-hide_banner',
        '-loglevel', 'warning',
        '-reconnect', '1',
        '-reconnect_streamed', '1',
        '-reconnect_delay_max', '4',
        '-i', url,
        '-map', '0:v:0',
        '-map', '0:a:0?',
        '-c:v', 'copy',
        '-c:a', 'aac',
        '-ac', '2',
        '-b:a', '192k',
        '-af', 'aresample=async=1:min_hard_comp=0.100:first_pts=0',
        '-g', isVOD ? '48' : '250', // keyframes frecuentes en VOD para seek
        '-f', 'mp4',
        '-movflags', movFlags,
        '-bufsize', bufSize,
        '-max_muxing_queue_size', '4096',
        '-flush_packets', '1',
        '-'
    ];

    console.log(`[NodeCast] Modo: ${isVOD ? 'PELÍCULA (Duración completa)' : 'LIVE (Baja Latencia)'}`);
    console.log(`[FFmpeg] Comando: ${ffmpegPath} ${args.join(' ')}`);

    const ffmpeg = spawn(ffmpegPath, args);

    // Tubería de salida al navegador
    ffmpeg.stdout.pipe(res);

    // Captura de errores
    ffmpeg.stderr.on('data', data => {
        const msg = data.toString();
        if (msg.toLowerCase().includes('error')) console.error('[FFmpeg Error]', msg);
    });

    // Limpieza al cerrar la pestaña
    req.on('close', () => {
        console.log('[Stream] Cliente desconectado, matando FFmpeg');
        ffmpeg.kill('SIGKILL');
    });

    ffmpeg.on('exit', code => {
        if (code && code !== 255) console.log(`[Stream] FFmpeg finalizó con código ${code}`);
    });

    ffmpeg.on('error', err => {
        console.error('[Stream] FFmpeg spawn failed:', err);
        if (!res.headersSent) res.status(500).json({ error: 'Transcoding failed' });
    });
});

module.exports = router;
