const express = require('express');
const router = express.Router();
const { spawn } = require('child_process');

router.get('/', (req, res) => {
    const { url, type } = req.query;
    if (!url) return res.status(400).json({ error: 'URL parameter is required' });

    const ffmpegPath = req.app.locals.ffmpegPath || 'ffmpeg';
    const isVOD = type === 'vod' || url.includes('/movie/') || url.toLowerCase().endsWith('.mkv');

    const movFlags = isVOD
        ? 'faststart+frag_keyframe+empty_moov+default_base_moof' 
        : 'frag_keyframe+empty_moov+default_base_moof';

    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Accept-Ranges', 'bytes');

    const args = [
        '-hide_banner',
        '-loglevel', 'warning',
        '-reconnect', '1',
        '-reconnect_at_eof', '1',
        '-reconnect_streamed', '1',
        '-reconnect_delay_max', '5',
        '-i', url,
        '-map', '0:v:0',
        '-map', '0:a:0?',
        '-c:v', 'copy',
        '-c:a', 'aac',
        '-ac', '2',
        '-b:a', '128k',
        '-af', 'aresample=async=1:min_hard_comp=0.100:first_pts=0',
        '-f', 'mp4',
        '-movflags', movFlags,
        '-bufsize', '20M',
        '-max_muxing_queue_size', '1024',
        '-'
    ];

    console.log(`[NodeCast] Iniciando: ${isVOD ? 'PELÍCULA' : 'LIVE'}`);

    const ffmpeg = spawn(ffmpegPath, args);

    // Pipe de datos
    ffmpeg.stdout.pipe(res);

    // Log de errores
    ffmpeg.stderr.on('data', data => {
        const msg = data.toString();
        if (msg.toLowerCase().includes('error')) console.error('[FFmpeg Error]', msg.trim());
    });

    // Flag para saber si ya inició la reproducción
    let streamingStarted = false;

    // Cuando FFmpeg envía los primeros datos, marcamos que la reproducción empezó
    ffmpeg.stdout.once('data', () => {
        streamingStarted = true;
    });

    // Detectar cierre de conexión real
    req.on('close', () => {
        if (!streamingStarted) {
            console.log('[Stream] Cliente hizo prueba rápida. No matamos FFmpeg aún.');
            // Esperamos unos segundos para que FFmpeg empiece a enviar datos reales
            const checkInterval = setInterval(() => {
                if (streamingStarted || res.writableEnded) {
                    clearInterval(checkInterval);
                } else {
                    console.log('[Stream] Sin reproducción real todavía...');
                }
            }, 500);
        } else {
            console.log('[Stream] Cliente desconectado después de iniciar reproducción. Cerrando FFmpeg...');
            if (!ffmpeg.killed) ffmpeg.kill('SIGKILL');
        }
    });

    ffmpeg.on('exit', code => {
        if (code && code !== 255) console.log(`[Stream] FFmpeg salió con código ${code}`);
    });
});

module.exports = router;
