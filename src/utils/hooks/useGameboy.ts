import { useEffect, useState } from "react";

// setup context stuff here...
const useGameboy = () => {
    const [isInit, setIsInit] = useState(false);

    useEffect(() => {
        // TODO: check if user has power on the gameboy (button)
        setIsInit(true);
    }, []);

    return {
        isInit,
    };
};

export default useGameboy;
