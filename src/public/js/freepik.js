$(document).ready(function() {
    var checkModal = setInterval(function() {
        if ($("modal-devices-limit") && $("#modal-devices-limit h6.title").text() == "You have reached your daily download limit.") {
            clearInterval(checkModal);
        } else {
            $("#modal-devices-limit h6.title").text("You have reached your daily download limit.");
            $("#modal-devices-limit div.title + p").text("You can not download assets anymore today. Please try tomorrow again.").css({margin: 0});
            $("#modal-devices-limit a.button").remove();
        }
    }, 100);
});