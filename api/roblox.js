export default async function handler(req, res) {
    try {
        const { action, keyword, userIds } = req.query;

        // =========================
        // SEARCH ROBLOX USER
        // =========================
        if (action === "search") {

            if (!keyword || keyword.length < 2) {
                return res.status(400).json({
                    error: "Username is too short"
                });
            }

            const response = await fetch(
                "https://users.roblox.com/v1/usernames/users",
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        usernames: [keyword],
                        excludeBannedUsers: false
                    })
                }
            );

            const data = await response.json();

            if (!response.ok) {
                return res.status(response.status).json(data);
            }

            return res.status(200).json(data);
        }


        // =========================
        // GET ROBLOX AVATAR
        // =========================
        if (action === "avatar") {

            if (!userIds) {
                return res.status(400).json({
                    error: "Missing user ID"
                });
            }

            const url =
                "https://thumbnails.roblox.com/v1/users/avatar-headshot" +
                "?userIds=" +
                encodeURIComponent(userIds) +
                "&size=150x150" +
                "&format=Png" +
                "&isCircular=false";

            const response = await fetch(url);

            const data = await response.json();

            if (!response.ok) {
                return res.status(response.status).json(data);
            }

            return res.status(200).json(data);
        }


        // =========================
        // INVALID ACTION
        // =========================
        return res.status(400).json({
            error: "Invalid action"
        });

    } catch (error) {

        console.error(error);

        return res.status(500).json({
            error: "Server failed to contact Roblox",
            details: error.message
        });
    }
}
