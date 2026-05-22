(function () {
    var REMOTE_ORIGIN = "https://missourimonster-vyla.hf.space";
    var nativeFetch = window.fetch.bind(window);
    var params = new URLSearchParams(window.location.search);
    var mediaId = params.get("id");
    var season = params.get("season");
    var episode = params.get("episode") || "1";
    var startAt = Number(params.get("startAt") || "0");
    var mediaType = season ? "tv" : "movie";
    var sourceCachePromise = null;

    function toUrl(input) {
        var raw = typeof input === "string" ? input : input && input.url;
        if (!raw) return null;
        try {
            return new URL(raw, window.location.href);
        } catch (error) {
            return null;
        }
    }

    function jsonResponse(data, status) {
        return Promise.resolve(new Response(JSON.stringify(data), {
            status: status || 200,
            headers: { "content-type": "application/json" },
        }));
    }

    function localApi(path, search) {
        return path + (search || "");
    }

    function loadSources() {
        if (!mediaId) return Promise.resolve([]);
        if (!sourceCachePromise) {
            var path = mediaType === "tv"
                ? "/api/321movies/tv?id=" + encodeURIComponent(mediaId) + "&season=" + encodeURIComponent(season || "1") + "&episode=" + encodeURIComponent(episode)
                : "/api/321movies/movie?id=" + encodeURIComponent(mediaId);

            sourceCachePromise = nativeFetch(path)
                .then(function (response) {
                    if (!response.ok) throw new Error("Source adapter HTTP " + response.status);
                    return response.json();
                })
                .then(function (data) {
                    return Array.isArray(data.sources) ? data.sources : [];
                })
                .catch(function () {
                    sourceCachePromise = null;
                    return [];
                });
        }

        return sourceCachePromise;
    }

    function buildSourceDirectory() {
        return loadSources().then(function (sources) {
            var seen = {};
            var bySource = {};

            sources.forEach(function (source, index) {
                var baseName = source.source || source.sourceKey || source.label || ("Source " + (index + 1));
                var name = baseName;
                if (seen[name]) name = baseName + " " + (seen[name] + 1);
                seen[baseName] = (seen[baseName] || 0) + 1;

                bySource[name] = {
                    movie: "/api/test/155?sourceIndex=" + index + "&source=" + encodeURIComponent(name),
                    tv: "/api/test/1396?sourceIndex=" + index + "&source=" + encodeURIComponent(name) + "&season=1&episode=1",
                };
            });

            return { tests: { bySource: bySource } };
        });
    }

    function cachedSourceResponse(url) {
        return loadSources().then(function (sources) {
            var index = Number(url.searchParams.get("sourceIndex"));
            var source = Number.isFinite(index) ? sources[index] : null;

            if (!source) {
                var wanted = (url.searchParams.get("source") || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
                source = sources.find(function (item) {
                    return [item.source, item.sourceKey, item.label, item.provider].some(function (value) {
                        return (value || "").toLowerCase().replace(/[^a-z0-9]+/g, "") === wanted;
                    });
                });
            }

            if (!source) return jsonResponse({ ok: false, error: "Source unavailable" });

            var delay = Math.min(Math.max(index || 0, 0), 8) * 35;
            return new Promise(function (resolve) {
                window.setTimeout(function () {
                    resolve(new Response(JSON.stringify({
                        ok: true,
                        source: source.source || source.label,
                        label: source.label || source.source,
                        url: source.url,
                        raw_url: source.raw_url || source.url,
                        type: source.type || "hls",
                    }), {
                        headers: { "content-type": "application/json" },
                    }));
                }, delay);
            });
        });
    }

    window.fetch = function (input, init) {
        var url = toUrl(input);
        if (!url) return nativeFetch(input, init);

        if (url.origin === REMOTE_ORIGIN) {
            if (url.pathname === "/" || url.pathname === "") {
                return buildSourceDirectory().then(function (data) {
                    return new Response(JSON.stringify(data), {
                        headers: { "content-type": "application/json" },
                    });
                });
            }

            if (url.pathname === "/api/movie") {
                return nativeFetch(localApi("/api/321movies/movie", url.search), init);
            }

            if (url.pathname === "/api/tv") {
                return nativeFetch(localApi("/api/321movies/tv", url.search), init);
            }

            if (url.pathname.indexOf("/api/test/") === 0) {
                return cachedSourceResponse(url);
            }

            if (url.pathname.indexOf("/api/subtitles/movie/") === 0) {
                return nativeFetch(url.pathname.replace("/api/subtitles", "/api/321movies/subtitles"), init);
            }

            if (url.pathname.indexOf("/api/subtitles/tv/") === 0) {
                return nativeFetch(url.pathname.replace("/api/subtitles", "/api/321movies/subtitles"), init);
            }

            if (url.pathname === "/api/proxy") {
                return nativeFetch("/api/player/subtitle-proxy?url=" + encodeURIComponent(url.searchParams.get("url") || ""), init);
            }

            if (url.pathname.indexOf("/api/downloads/") === 0) {
                return nativeFetch(url.pathname.replace("/api/downloads", "/api/321movies/downloads"), init);
            }
        }

        if (url.origin === window.location.origin && url.pathname === "/api/proxy") {
            return nativeFetch("/api/player/subtitle-proxy?url=" + encodeURIComponent(url.searchParams.get("url") || ""), init);
        }

        return nativeFetch(input, init);
    };

    function postPlayerEvent(eventName, video) {
        if (!video || !window.parent || window.parent === window) return;
        var currentTime = Number.isFinite(video.currentTime) ? video.currentTime : 0;
        var duration = Number.isFinite(video.duration) ? video.duration : 0;

        window.parent.postMessage({
            type: "LOCAL_PLAYER_EVENT",
            data: {
                event: eventName,
                currentTime: currentTime,
                duration: duration,
                mediaId: mediaId || 0,
                mediaType: mediaType,
                season: season ? Number(season) : undefined,
                episode: season ? Number(episode || "1") : undefined,
                progress: duration > 0 ? currentTime / duration : 0,
                playerSource: "321movies",
            },
        }, "*");
    }

    function openSourceMenu() {
        var wrap = document.getElementById("settings-modal-wrap");
        var settingsButton = document.getElementById("btn-settings");

        if (settingsButton && (!wrap || !wrap.classList.contains("open"))) {
            settingsButton.click();
        }

        window.setTimeout(function () {
            var sourceTile = document.querySelector('.settings-tile[data-nav="sources"]');
            if (sourceTile) {
                sourceTile.dispatchEvent(new MouseEvent("click", { bubbles: true }));
            }
        }, 80);
    }

    function applySync(message) {
        var video = document.getElementById("v");
        if (!video) return;

        if (message.action === "seek" && typeof message.time === "number") {
            video.currentTime = message.time;
        } else if (message.action === "play") {
            video.play().catch(function () { });
        } else if (message.action === "pause") {
            video.pause();
        }
    }

    function wireParentBridge() {
        var video = document.getElementById("v");
        if (!video) return;

        var startApplied = false;
        var lastTimeUpdate = 0;

        video.addEventListener("loadedmetadata", function () {
            if (!startApplied && startAt > 0 && Number.isFinite(video.duration)) {
                video.currentTime = Math.min(startAt, Math.max(video.duration - 2, 0));
                startApplied = true;
            }
        });

        ["play", "pause", "seeked", "ended"].forEach(function (eventName) {
            video.addEventListener(eventName, function () {
                postPlayerEvent(eventName, video);
            });
        });

        video.addEventListener("timeupdate", function () {
            var now = Date.now();
            if (now - lastTimeUpdate < 2000) return;
            lastTimeUpdate = now;
            postPlayerEvent("timeupdate", video);
        });

        window.addEventListener("message", function (event) {
            var data = event.data || {};
            if (data.type === "VYLA_PLAYER_SYNC") applySync(data);
            if (data.type === "VYLA_OPEN_SOURCE_MENU") openSourceMenu();
        });

        var errorScreen = document.getElementById("error-screen");
        if (errorScreen) {
            var observer = new MutationObserver(function () {
                if (!errorScreen.classList.contains("show")) return;
                window.parent.postMessage({
                    type: "VYLA_PLAYER_FATAL_ERROR",
                    message: errorScreen.textContent || "321movies player error",
                }, "*");
            });
            observer.observe(errorScreen, { attributes: true, attributeFilter: ["class"] });
        }
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", wireParentBridge);
    } else {
        wireParentBridge();
    }
})();
