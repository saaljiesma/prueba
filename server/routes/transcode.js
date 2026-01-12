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
    const isVOD = type === 'vod' || url.includes('/movie/') || url.toLowerCase().endsWith('.mkv');

    // CONFIGURACIÓN CRÍTICA PARA SEEK
    // VOD: Eliminamos frag_keyframe para que el navegador lo vea como un archivo MP4 estándar.
    const movFlags = isVOD
        ? 'faststart+empty_moov+omit_tfhd_offset+frag_discont' 
        : 'frag_keyframe+empty_moov+default_base_moof';

    const bufSize = isVOD ? '100M' : '10M';

    // Headers necesarios para habilitar el salto de tiempo (Accept-Ranges)
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Accept-Ranges', 'bytes'); // Indica al navegador que puede pedir partes del archivo

    const args = [
        '-hide_banner',
        '-loglevel', 'warning',
        '-seekable', '1', // Permite que FFmpeg salte en el origen si el servidor IPTV lo soporta
        '-reconnect', '1',
        '-reconnect_streamed', '1',
        '-reconnect_delay_max', '4',
        '-i', url,
        '-map', '0:v:0',
        '-map', '0:a:0?',
        '-c:v', 'copy', // Mantiene video original (0% CPU en RPi4)
        '-c:a', 'aac',  // Audio compatible universal
        '-ac', '2',
        '-b:a', '192k',
        '-af', 'aresample=async=1:min_hard_comp=0.100:first_pts=0',
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

    // Tubería de salida
    ffmpeg.stdout.pipe(res);

    ffmpeg.stderr.on('data', data => {
        const msg = data.toString();
        if (msg.toLowerCase().includes('error')) console.error('[FFmpeg Error]', msg);
    });

    req.on('close', () => {
        console.log('[Stream] Cliente desconectado, cerrando FFmpeg');
        ffmpeg.kill('SIGKILL');
    });

    ffmpeg.on('exit', code => {
        if (code && code !== 255) console.log(`[Stream] FFmpeg salió con código ${code}`);
    });
});

module.exports = router;