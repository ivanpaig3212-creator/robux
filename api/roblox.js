const cache = new Map();

const CACHE_TIME = 30000; // 30 seconds

function getCache(key) {
    const item = cache.get(key);

    if (!item) {
        return null;
    }

    if (Date.now() - item.time > CACHE_TIME) {
        cache.delete(key);
        return null;
    }

    return item.data;
}

function setCache(key, data) {
    cache.set(key, {
        time: Date.now(),
        data
    });

    // Prevent the cache from growing forever
    if (cache.size > 100) {
        const firstKey = cache.keys().next().value;

        if (firstKey) {
            cache.delete(firstKey);
        }
    }
}


async function sleep(ms) {
    return new Promise(resolve => {
        setTimeout(resolve, ms);
    });
}


async function fetchRoblox(url, attempts = 4) {

    let lastStatus = null;
    let lastText = "";

    for (let attempt = 0; attempt < attempts; attempt++) {

        try {

            const response = await fetch(url, {
                headers: {
                    "Accept": "application/json"
                }
            });

            lastStatus = response.status;

            const text = await response.text();

            lastText = text;

            // SUCCESS
            if (response.ok) {

                return {
                    ok: true,
                    status: response.status,
                    text
                };

            }


            // TEMPORARY ROBLOX ERROR
            const temporaryError =
                response.status === 429 ||
                response.status === 500 ||
                response.status === 502 ||
                response.status === 503 ||
                response.status === 504;


            if (!temporaryError) {

                return {
                    ok: false,
                    status: response.status,
                    text
                };

            }


            // Roblox can tell us how long to wait
            const retryAfter =
                response.headers.get("retry-after");


            let waitTime;


            if (retryAfter) {

                const seconds =
                    Number(retryAfter);

                if (Number.isFinite(seconds)) {

                    waitTime =
                        Math.min(
                            seconds * 1000,
                            8000
                        );

                }

            }


            // Exponential backoff fallback
            if (!waitTime) {

                waitTime =
                    Math.min(
                        700 * Math.pow(2, attempt),
                        8000
                    );

            }


            console.log(
                "Roblox temporary error:",
                response.status,
                "Retrying in",
                waitTime,
                "ms"
            );


            await sleep(waitTime);

        } catch (error) {

            console.error(
                "Roblox connection error:",
                error
            );


            lastText =
                error.message || "Network error";


            const waitTime =
                Math.min(
                    700 * Math.pow(2, attempt),
                    8000
                );


            await sleep(waitTime);
        }
    }


    return {
        ok: false,
        status: lastStatus || 503,
        text: lastText
    };
}



function sendJson(res, status, data) {

    return res
        .status(status)
        .setHeader(
            "Content-Type",
            "application/json"
        )
        .setHeader(
            "Cache-Control",
            "no-store"
        )
        .json(data);
}



export default async function handler(req, res) {

    try {

        const {
            action,
            keyword,
            userIds,
            userId
        } = req.query;


        /* =====================================================
           SEARCH USERS
        ===================================================== */

        if (action === "search") {

            if (!keyword || keyword.trim().length < 2) {

                return sendJson(res, 400, {
                    error: "Username is too short"
                });

            }


            const cleanKeyword =
                keyword.trim();


            const cacheKey =
                "search:" +
                cleanKeyword.toLowerCase();


            const cached =
                getCache(cacheKey);


            if (cached) {

                return sendJson(
                    res,
                    200,
                    cached
                );

            }


            const url =
                "https://users.roblox.com/v1/users/search" +
                "?keyword=" +
                encodeURIComponent(cleanKeyword) +
                "&limit=10";


            const result =
                await fetchRoblox(url);


            if (!result.ok) {

                console.error(
                    "Roblox search failed:",
                    result.status,
                    result.text
                );


                return sendJson(res, 503, {

                    error:
                        "Roblox is temporarily unavailable.",

                    retryable: true,

                    status:
                        result.status

                });

            }


            let data;


            try {

                data =
                    JSON.parse(result.text);

            } catch {

                return sendJson(res, 503, {

                    error:
                        "Roblox returned an invalid response.",

                    retryable: true

                });

            }


            setCache(
                cacheKey,
                data
            );


            return sendJson(
                res,
                200,
                data
            );
        }



        /* =====================================================
           AVATAR
        ===================================================== */

        if (action === "avatar") {

            if (!userIds) {

                return sendJson(res, 400, {
                    error: "Missing userIds"
                });

            }


            const cleanIds =
                userIds
                    .split(",")
                    .map(id => id.trim())
                    .filter(Boolean)
                    .slice(0, 20);


            if (cleanIds.length === 0) {

                return sendJson(res, 400, {
                    error: "Invalid userIds"
                });

            }


            const cacheKey =
                "avatar:" +
                cleanIds.join(",");


            const cached =
                getCache(cacheKey);


            if (cached) {

                return sendJson(
                    res,
                    200,
                    cached
                );

            }


            const url =
                "https://thumbnails.roblox.com/v1/users/avatar-headshot" +
                "?userIds=" +
                encodeURIComponent(
                    cleanIds.join(",")
                ) +
                "&size=150x150" +
                "&format=Png" +
                "&isCircular=false";


            const result =
                await fetchRoblox(url);


            if (!result.ok) {

                console.error(
                    "Roblox avatar failed:",
                    result.status,
                    result.text
                );


                return sendJson(res, 503, {

                    error:
                        "Roblox avatar service is temporarily unavailable.",

                    retryable: true,

                    status:
                        result.status

                });

            }


            let data;


            try {

                data =
                    JSON.parse(result.text);

            } catch {

                return sendJson(res, 503, {

                    error:
                        "Roblox returned an invalid avatar response.",

                    retryable: true

                });

            }


            setCache(
                cacheKey,
                data
            );


            return sendJson(
                res,
                200,
                data
            );
        }



        /* =====================================================
           USER DETAILS
        ===================================================== */

        if (action === "details") {

            if (!userId) {

                return sendJson(res, 400, {
                    error: "Missing userId"
                });

            }


            const cleanUserId =
                String(userId).trim();


            const cacheKey =
                "details:" +
                cleanUserId;


            const cached =
                getCache(cacheKey);


            if (cached) {

                return sendJson(
                    res,
                    200,
                    cached
                );

            }


            const url =
                "https://users.roblox.com/v1/users/" +
                encodeURIComponent(cleanUserId);


            const result =
                await fetchRoblox(url);


            if (!result.ok) {

                console.error(
                    "Roblox details failed:",
                    result.status,
                    result.text
                );


                return sendJson(res, 503, {

                    error:
                        "Roblox user details are temporarily unavailable.",

                    retryable: true,

                    status:
                        result.status

                });

            }


            let data;


            try {

                data =
                    JSON.parse(result.text);

            } catch {

                return sendJson(res, 503, {

                    error:
                        "Roblox returned an invalid user response.",

                    retryable: true

                });

            }


            setCache(
                cacheKey,
                data
            );


            return sendJson(
                res,
                200,
                data
            );
        }



        /* =====================================================
           INVALID ACTION
        ===================================================== */

        return sendJson(res, 400, {
            error: "Invalid action"
        });


    } catch (error) {

        console.error(
            "Roblox API server error:",
            error
        );


        return sendJson(res, 503, {

            error:
                "Could not connect to Roblox right now.",

            retryable: true,

            details:
                error.message

        });

    }
}
