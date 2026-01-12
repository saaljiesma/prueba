const express = require('express');
const router = express.Router();
const { spawn } = require('child_process');

/**
 * Stream VOD/LIVE optimizado para barra completa y seek
 */
router.get('/', (req, res) => {
    const { url, type } = req.query;
    if (!url) return res.status(400).json({ error: 'URL parameter is required' });

    const ffmpegPath = req.app.locals.ffmpegPath || 'ffmpeg';

    // ✅ DETECCIÓN MEJORADA: 
    // Ahora identifica VOD por el parámetro TYPE o inspeccionando la URL
    const isVOD = type === 'vod' || 
                  url.includes('/movie/') || 
                  url.includes('/series/') || 
                  url.toLowerCase().endsWith('.mkv') || 
                  url.toLowerCase().endsWith('.mp4');

    // ✅ MOVFLAGS CORREGIDOS PARA SEEK:
    // Para VOD, eliminamos 'frag_keyframe' que es lo que rompe la barra de búsqueda.
    // Usamos 'faststart' para que el navegador pueda leer el índice del video.
    const movFlags = isVOD
        ? 'faststart+empty_moov+omit_tfhd_offset+frag_discont' 
        : 'frag_keyframe+empty_moov+default_base_moof';

    const bufSize = isVOD ? '100M' : '10M';

    // Headers para navegador - Añadimos Accept-Ranges para habilitar el salto
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (isVOD) res.setHeader('Accept-Ranges', 'bytes'); 

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
        '-c:v', 'copy',
        '-c:a', 'aac',
        '-ac', '2',
        '-b:a', '192k',
        '-af', 'aresample=async=1:min_hard_comp=0.100:first_pts=0',
        // En VOD no forzamos -g 48 si usamos copy, dejamos que el original mande
        '-f', 'mp4',
        '-movflags', movFlags,
        '-bufsize', bufSize,
        '-max_muxing_queue_size', '4096',
        '-'
    ];

    console.log(`[NodeCast] Iniciando: ${isVOD ? 'PELÍCULA (Modo Seek Habilitado)' : 'LIVE (Baja Latencia)'}`);
    console.log(`[FFmpeg] Comando completo: ${ffmpegPath} ${args.join(' ')}`);

    const ffmpeg = spawn(ffmpegPath, args);

    ffmpeg.stdout.pipe(res);

    ffmpeg.stderr.on('data', data => {
        const msg = data.toString();
        if (msg.toLowerCase().includes('error')) console.error('[FFmpeg Error]', msg);
    });

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